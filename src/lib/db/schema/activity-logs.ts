import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";
import { bars } from "./venue";

/**
 * Jejak aktivitas STAFF — "siapa melakukan apa, kapan".
 *
 * Dipakai admin/manager untuk mengawasi kerja kasir/waiter (halaman
 * /admin/activity). Dicatat lewat helper logActivity() di server action.
 *
 * Prinsip:
 * - Best-effort: gagal mencatat TIDAK boleh menggagalkan aksi aslinya
 *   (mis. pembayaran tetap sukses walau log gagal ditulis).
 * - Snapshot: actorName & actorRole disimpan sebagai TEKS saat kejadian, jadi
 *   riwayat tetap akurat walau nama/role staff berubah atau akunnya dihapus.
 * - summary = kalimat siap tampil, supaya UI tak perlu merangkai ulang.
 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Staff pelaku. NULL kalau akunnya sudah dihapus (nama tetap tersimpan). */
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** Snapshot nama & role saat kejadian (tak ikut berubah kelak). */
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    /** Kode aksi, mis. 'payment.received' | 'session.closed' | 'table.opened'. */
    action: text("action").notNull(),
    /** Kelompok besar utk filter: payment | order | session | move | customer | admin. */
    category: text("category").notNull(),
    /** Objek yang disentuh (opsional) — utk menautkan ke halaman detail. */
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    /** Kalimat siap tampil, mis. "Terima pembayaran Rp 250.000 meja T3". */
    summary: text("summary").notNull(),
    /** Detail tambahan (jumlah, metode, dsb) — bebas per jenis aksi. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // List utama: per bar, terbaru dulu.
    index("idx_activity_logs_bar_at").on(t.barId, t.createdAt),
    // Filter "aktivitas staff X".
    index("idx_activity_logs_actor_at").on(t.actorId, t.createdAt),
  ]
);
