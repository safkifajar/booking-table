import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { membershipTxKindEnum, paymentStatusEnum } from "./_enums";
import { membershipLevels, membershipVouchers } from "./membership";
import { profiles } from "./profiles";

/**
 * Transaksi membership (PRD Membership 4.3, rev-2) — file TERPISAH dari
 * membership.ts supaya dependency schema tetap satu arah:
 * membership.ts → (tak impor apa pun) ← profiles.ts, lalu file ini →
 * profiles + membership. profiles.ts boleh impor membership.ts (FK level)
 * tanpa siklus.
 *
 * SEMUA parameter di-SNAPSHOT saat transaksi dibuat (level, periode, harga,
 * tax & service) — admin boleh mengubah konfigurasi level/charge di tengah
 * QR pending tanpa merusak transaksi (PRD 8). Tabel sendiri (bukan menumpang
 * `payments` yang FK NOT NULL ke orders); gateway QRIS-nya tetap sama.
 *
 * rev-2: kolom voucher_id DIHAPUS (voucher bukan lagi diskon membership) +
 * tax_amount & service_amount ditambahkan (dari ChargeConfig bar, sama dgn
 * bill F&B): amount = base + tax + service.
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
    /** Harga level (snapshot, sebelum tax & service). */
    baseAmount: integer("base_amount").notNull(),
    /** Pajak (snapshot dari ChargeConfig bar saat transaksi dibuat). */
    taxAmount: integer("tax_amount").notNull().default(0),
    /** Service charge (snapshot). */
    serviceAmount: integer("service_amount").notNull().default(0),
    /** Total ditagih ke gateway = base + tax + service. */
    amount: integer("amount").notNull(),
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

/**
 * INSTANCE voucher pribadi per member (PRD Membership rev-2): digenerate
 * saat aktivasi membership dari template aktif level tsb. Kode UNIK per
 * orang. Aturan di-SNAPSHOT dari template (admin mengubah template tak
 * mengubah voucher yang sudah beredar).
 *
 * Siklus redeem (potongan transaksi pembayaran bill):
 * - RESERVED: used_payment_id terisi, used_at NULL — menempel ke payment
 *   QRIS yang masih pending (tak bisa dipakai payment lain);
 * - USED: used_at terisi saat payment-nya PAID (+ baris payments sintetis
 *   method='voucher' senilai potongan → outstanding bill tertutup benar);
 * - dilepas (used_payment_id di-NULL-kan) kalau payment gagal/dibatalkan.
 */
export const memberVouchers = pgTable(
  "member_vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => membershipVouchers.id, { onDelete: "restrict" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** Kode unik per instance (mis. SOHO-AB12-CD34) — beda tiap orang. */
    code: text("code").notNull(),
    /** Snapshot aturan dari template saat generate. */
    name: text("name").notNull(),
    discountType: text("discount_type").notNull(), // 'percent' | 'fixed'
    discountValue: integer("discount_value").notNull(),
    maxDiscount: integer("max_discount"),
    minSpend: integer("min_spend"),
    /** Transaksi membership asal (audit). */
    membershipTxId: uuid("membership_tx_id").references(
      () => membershipTransactions.id,
      { onDelete: "set null" }
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    /** Payment bill yang memakai voucher ini (reservasi saat QR pending). */
    usedPaymentId: uuid("used_payment_id"),
    /**
     * Nominal potongan yang DIKUNCI saat reservasi (dihitung dari amount
     * payment saat itu) — dipakai saat settle utk baris payments sintetis.
     */
    discountApplied: integer("discount_applied"),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_member_vouchers_code").on(t.code),
    index("idx_member_vouchers_profile").on(t.profileId, t.createdAt),
    index("idx_member_vouchers_payment").on(t.usedPaymentId),
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
  })
);

export const memberVouchersRelations = relations(memberVouchers, ({ one }) => ({
  template: one(membershipVouchers, {
    fields: [memberVouchers.templateId],
    references: [membershipVouchers.id],
  }),
  profile: one(profiles, {
    fields: [memberVouchers.profileId],
    references: [profiles.id],
  }),
}));
