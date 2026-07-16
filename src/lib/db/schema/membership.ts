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
 * TEMPLATE voucher benefit membership (PRD Membership rev-2, 2026-07-15).
 *
 * Voucher = BENEFIT member, BUKAN kode promo beli membership. Admin membuat
 * template (nama + aturan potongan transaksi bill) yang terhubung ke level;
 * saat membership AKTIF (beli/perpanjang/admin grant), tiap member menerima
 * INSTANCE pribadi (member_vouchers) dgn kode unik yang di-generate —
 * kode tiap orang berbeda. Redeem: potongan transaksi pembayaran bill meja.
 */
export const membershipVouchers = pgTable(
  "membership_vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nama voucher (mis. "Premium Dining Discount") — tampil ke member. */
    name: text("name").notNull(),
    discountType: voucherDiscountTypeEnum("discount_type").notNull(),
    /** percent: 1–100 · fixed: rupiah. */
    discountValue: integer("discount_value").notNull(),
    /** Batas maksimal potongan (utk percent). NULL = tanpa batas. */
    maxDiscount: integer("max_discount"),
    /** Minimal nominal pembayaran agar voucher bisa dipakai. NULL = tanpa. */
    minSpend: integer("min_spend"),
    /** NULL = semua level purchasable; selain itu khusus level tsb. */
    levelKey: text("level_key").references(() => membershipLevels.key, {
      onDelete: "restrict",
    }),
    /** Masa berlaku instance: X hari sejak digenerate (keputusan user). */
    validDays: integer("valid_days").notNull().default(30),
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
    check("ck_membership_vouchers_valid_days", sql`${t.validDays} >= 1`),
  ]
);
