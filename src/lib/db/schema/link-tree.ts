import { pgTable, uuid, text, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";
import { bars } from "./venue";

/**
 * Tautan di halaman "link tree" publik (link.<domain>) — dipasang di bio
 * Instagram SOHO.
 *
 * Tabel terpisah (bukan kolom jsonb di bars) karena isinya DAFTAR yang
 * di-CRUD per baris & diurutkan: menambah satu tautan tak boleh menulis
 * ulang seluruh konfigurasi bar.
 *
 * Tiga tautan bawaan (aplikasi, WhatsApp, alamat) TIDAK disimpan di sini —
 * dirakit dari data yang sudah ada (bars.address, CONTACT_WA) supaya tak
 * perlu diketik ulang & ikut berubah kalau datanya berubah. Yang tersimpan
 * hanya preferensi tampil/urutannya (lihat linkTreeConfig di bars).
 */
export const barLinks = pgTable(
  "bar_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    /** Nama ikon dari daftar kurasi (lib/link-icons.ts), mis. "instagram". */
    icon: text("icon").notNull().default("link"),
    /** Deskripsi singkat di bawah label (opsional). */
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Halaman publik: ambil tautan aktif satu bar, terurut.
    index("idx_bar_links_bar_order").on(t.barId, t.isActive, t.sortOrder),
  ]
);
