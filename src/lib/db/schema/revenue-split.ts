import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { paymentMethodEnum } from "./_enums";
import { profiles } from "./profiles";

/**
 * Sistem Bagi Hasil service fee (PRD bagi-hasil rev-2).
 *
 * - Skema BER-VERSI & abadi: tiap simpan = baris skema baru (versi naik);
 *   versi lama tak pernah diubah — snapshot historis tetap sah.
 * - Kategori = PERSEN LANGSUNG (input PM) dlm MILIPERSEN (1% = 1000) supaya
 *   aritmetika integer deterministik (1,694% = 1694). Opsional terikat
 *   metode bayar (QRIS 0,7% tak berlaku utk cash). Tepat SATU kategori
 *   penampung (is_remainder_sink) menyerap sisa/pembulatan → Σ selalu =
 *   service terkumpul.
 * - Entries = snapshot rupiah per (sumber, kategori) — sumber bill payment
 *   ATAU transaksi membership (G7). UNIQUE menjaga idempotensi.
 */

export const splitEntryKindEnum = pgEnum("split_entry_kind", [
  "split",
  "reversal",
]);

export const splitSourceEnum = pgEnum("split_source", ["bill", "membership"]);

export const splitSchemes = pgTable(
  "split_schemes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Versi naik monoton; UNIQUE. */
    version: integer("version").notNull(),
    /** Berlaku utk sumber yang PAID sejak tanggal ini (maju, tak retroaktif). */
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" })
      .notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("uq_split_schemes_version").on(t.version)]
);

export const splitSchemeCategories = pgTable(
  "split_scheme_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schemeId: uuid("scheme_id")
      .notNull()
      .references(() => splitSchemes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Milipersen dari BASIS subtotal transaksi (1% = 1000; 0,7% = 700). */
    percentMilli: integer("percent_milli").notNull(),
    /** NULL = berlaku semua metode; selain itu hanya payment metode tsb. */
    method: paymentMethodEnum("method"),
    /** Penampung sisa & pembulatan — tepat satu per skema (dijaga aplikasi). */
    isRemainderSink: boolean("is_remainder_sink").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("idx_split_categories_scheme").on(t.schemeId),
    check("ck_split_categories_percent", sql`${t.percentMilli} > 0`),
  ]
);

export const splitEntries = pgTable(
  "split_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: splitSourceEnum("source").notNull(),
    /** payments.id (bill) / membership_transactions.id (membership). */
    sourceId: uuid("source_id").notNull(),
    schemeId: uuid("scheme_id")
      .notNull()
      .references(() => splitSchemes.id, { onDelete: "restrict" }),
    /** Snapshot nama kategori saat dihitung. */
    categoryName: text("category_name").notNull(),
    /** Rupiah, SIGNED — reversal bernilai minus; sink bisa minus (G6). */
    amount: integer("amount").notNull(),
    /** Porsi service yang terkumpul dari sumber ini (basis balance). */
    serviceCollected: integer("service_collected").notNull(),
    kind: splitEntryKindEnum("kind").notNull().default("split"),
    /** Waktu PAID sumber — dasar rekap periode settlement (bulanan). */
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_split_entries_source_cat_kind").on(
      t.source,
      t.sourceId,
      t.categoryName,
      t.kind
    ),
    index("idx_split_entries_paid_at").on(t.paidAt),
    index("idx_split_entries_source").on(t.source, t.sourceId),
  ]
);

export const splitSettlements = pgTable(
  "split_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Periode bulanan "YYYY-MM" (G4). */
    period: text("period").notNull(),
    categoryName: text("category_name").notNull(),
    /** Total yang ditandai settled utk periode+kategori tsb (audit angka). */
    total: integer("total").notNull(),
    settledBy: uuid("settled_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_split_settlements_period_cat").on(t.period, t.categoryName),
  ]
);

export const splitAuditLog = pgTable(
  "split_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** 'scheme.create' | 'settlement.mark' | dst. */
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_split_audit_at").on(t.createdAt)]
);
