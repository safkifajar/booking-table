import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { bars } from "./venue";
import { bannerCategoryEnum } from "./_enums";

/**
 * Bar promo banner — admin-uploadable carousel di landing.
 *
 * - sortOrder: smaller first
 * - isActive: hard toggle (selain check date range)
 * - startsAt/endsAt: nullable — kalau null = always show
 *
 * Index (barId, isActive, endsAt) untuk query "active banners untuk bar X
 * yang belum expire" cepat.
 */
export const barBanners = pgTable(
  "bar_banners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    /** Kategori: promo (default) atau event → badge di banner customer. */
    category: bannerCategoryEnum("category").notNull().default("promo"),
    title: text("title"),
    subtitle: text("subtitle"),
    /**
     * Isi detail promo (multi-paragraf, mis. syarat & ketentuan). Ditampilkan
     * di halaman detail /promo/[id] saat customer mengklik banner. NULL/kosong
     * = halaman detail hanya menampilkan gambar + judul + subtitle.
     */
    content: text("content"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    /**
     * Kapan notifikasi "promo baru" dikirim ke customer. NULL = belum.
     * Penanda anti-dobel: cron jalan berkala, tanpa ini SEMUA customer
     * dikirimi notif berulang setiap cron menyala.
     */
    notifiedAt: timestamp("notified_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "ck_bar_banners_title_length",
      sql`char_length(${t.title}) <= 80`
    ),
    check(
      "ck_bar_banners_subtitle_length",
      sql`char_length(${t.subtitle}) <= 200`
    ),
    index("idx_bar_banners_bar_active").on(t.barId, t.isActive, t.sortOrder),
  ]
);

export const barBannersRelations = relations(barBanners, ({ one }) => ({
  bar: one(bars, { fields: [barBanners.barId], references: [bars.id] }),
}));
