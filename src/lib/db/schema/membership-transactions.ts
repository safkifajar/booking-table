import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { membershipTxKindEnum, paymentStatusEnum } from "./_enums";
import { membershipLevels, membershipVouchers } from "./membership";
import { profiles } from "./profiles";

/**
 * Transaksi membership (PRD Membership 4.3) — file TERPISAH dari
 * membership.ts supaya dependency schema tetap satu arah:
 * membership.ts → (tak impor apa pun) ← profiles.ts, lalu file ini →
 * profiles + membership. profiles.ts boleh impor membership.ts (FK level)
 * tanpa siklus.
 *
 * SEMUA parameter di-SNAPSHOT saat transaksi dibuat (level, periode,
 * harga, diskon) — admin boleh mengubah konfigurasi level/voucher di tengah
 * QR pending tanpa merusak transaksi (PRD 8). Tabel sendiri (bukan menumpang
 * `payments` yang FK NOT NULL ke orders); gateway QRIS-nya tetap sama.
 */
export const membershipTransactions = pgTable(
  "membership_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    levelKey: text("level_key")
      .notNull()
      .references(() => membershipLevels.key, { onDelete: "restrict" }),
    kind: membershipTxKindEnum("kind").notNull().default("purchase"),
    /** Harga level sebelum voucher (snapshot). */
    baseAmount: integer("base_amount").notNull(),
    /** Yang ditagih ke gateway setelah diskon; 0 = aktivasi instan. */
    amount: integer("amount").notNull(),
    voucherId: uuid("voucher_id").references(() => membershipVouchers.id, {
      onDelete: "set null",
    }),
    /** Snapshot periode yang AKAN diberikan saat paid. */
    periodStart: timestamp("period_start", { withTimezone: true, mode: "date" })
      .notNull(),
    /** NULL = lifetime (billing one_time). */
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }),
    status: paymentStatusEnum("status").notNull().default("pending"),
    method: text("method").notNull().default("qris"),
    externalRef: text("external_ref"),
    /** QR disimpan supaya bisa ditampilkan ulang saat user kembali ke halaman. */
    qrString: text("qr_string"),
    qrExpiresAt: timestamp("qr_expires_at", { withTimezone: true, mode: "date" }),
    /** Admin yang memberi, untuk kind='admin_grant'. */
    grantedBy: uuid("granted_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_membership_tx_profile").on(t.profileId, t.createdAt),
    index("idx_membership_tx_status").on(t.status),
    check("ck_membership_tx_amount", sql`${t.amount} >= 0`),
    check("ck_membership_tx_base_amount", sql`${t.baseAmount} >= 0`),
  ]
);

export const membershipTransactionsRelations = relations(
  membershipTransactions,
  ({ one }) => ({
    profile: one(profiles, {
      fields: [membershipTransactions.profileId],
      references: [profiles.id],
    }),
    level: one(membershipLevels, {
      fields: [membershipTransactions.levelKey],
      references: [membershipLevels.key],
    }),
    voucher: one(membershipVouchers, {
      fields: [membershipTransactions.voucherId],
      references: [membershipVouchers.id],
    }),
  })
);
