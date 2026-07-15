import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  membershipBillingPeriodEnum,
  voucherDiscountTypeEnum,
} from "./_enums";

/**
 * Level membership — 3 baris seed (PRD Membership M2), dikelola admin.
 *
 * `key` & `rank` IMMUTABLE (aturan visibilitas hard-coded ke rank di
 * src/lib/membership.ts); yang boleh diubah admin: name, price,
 * billing_period, description.
 *
 * PENTING: tabel + seed dibuat oleh drizzle/0059_membership.sql (pre-migrate)
 * SEBELUM db:push menambah kolom FK di profiles — kolom baru profiles
 * default 'basic' butuh baris 'basic' sudah ada. DDL di file SQL itu harus
 * SAMA PERSIS dengan definisi di sini (kalau beda, db:push mengusulkan ALTER).
 */
export const membershipLevels = pgTable(
  "membership_levels",
  {
    /** 'basic' | 'premium' | 'vip' — dipakai kode, tak pernah berubah. */
    key: text("key").primaryKey(),
    /** 1=basic, 2=premium, 3=vip — dasar semua perbandingan visibilitas. */
    rank: integer("rank").notNull(),
    /** Nama tampilan — editable admin (mis. "Silver"/"Gold"). */
    name: text("name").notNull(),
    /** Harga IDR per periode. basic dipaksa 0 (non-purchasable). */
    price: integer("price").notNull().default(0),
    billingPeriod: membershipBillingPeriodEnum("billing_period")
      .notNull()
      .default("monthly"),
    /** Copy benefit untuk halaman beli. */
    description: text("description"),
    /** basic = false; hanya level purchasable yang tampil di halaman beli. */
    isPurchasable: boolean("is_purchasable").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_membership_levels_rank").on(t.rank),
    check("ck_membership_levels_price", sql`${t.price} >= 0`),
  ]
);

/**
 * Voucher diskon pembelian/perpanjangan membership (PRD M7, G9).
 * Kuota dijaga race-safe saat AKTIVASI: conditional update
 * `used_count = used_count + 1 WHERE used_count < max_uses` (PRD 8).
 */
export const membershipVouchers = pgTable(
  "membership_vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Disimpan UPPERCASE; input user di-uppercase-kan sebelum lookup. */
    code: text("code").notNull().unique("uq_membership_vouchers_code"),
    discountType: voucherDiscountTypeEnum("discount_type").notNull(),
    /** percent: 1–100 · fixed: rupiah. Final di-clamp minimum 0 (PRD 8). */
    discountValue: integer("discount_value").notNull(),
    /** NULL = berlaku semua level purchasable. */
    levelKey: text("level_key").references(() => membershipLevels.key, {
      onDelete: "restrict",
    }),
    /** NULL = kuota tak terbatas. */
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    perUserLimit: integer("per_user_limit").notNull().default(1),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("ck_membership_vouchers_value", sql`${t.discountValue} > 0`),
    check(
      "ck_membership_vouchers_percent_max",
      sql`${t.discountType} <> 'percent' OR ${t.discountValue} <= 100`
    ),
  ]
);
