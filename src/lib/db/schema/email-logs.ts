import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Catatan setiap email yang DICOBA dikirim aplikasi.
 *
 * Ada supaya keluhan "email saya tak sampai" bisa ditelusuri: tanpa ini kita
 * cuma bisa menebak apakah emailnya benar-benar dikirim, ditolak penyedia,
 * atau memang tak pernah diminta.
 *
 * Dicatat SETELAH percobaan kirim, jadi yang gagal pun ikut tercatat lengkap
 * dengan pesan galat penyedia — justru itu yang paling dibutuhkan saat debug.
 *
 * `bodyHtml` disimpan penuh atas permintaan admin, untuk memeriksa tampilan
 * email yang benar-benar terkirim. PERHATIAN: email reset password memuat
 * tautan yang masih aktif 30 menit — karena itu halaman lognya dibatasi
 * untuk admin saja, bukan manager/staf.
 *
 * Dibersihkan otomatis setelah 90 hari (purgeOldEmailLogs) supaya tabel tak
 * tumbuh tanpa batas.
 */
export const emailLogs = pgTable(
  "email_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Alamat tujuan. */
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    /**
     * Jenis email — "password_reset" | "magic_link" | "staff_invite" |
     * "table_invite" | "test" | "other". Teks bebas, bukan enum, supaya
     * menambah jenis baru tak perlu migrasi.
     */
    kind: text("kind").notNull().default("other"),
    /** "success" | "failed" | "dry_run". */
    status: text("status").notNull(),
    /** "onesignal" | "resend" | "dry-run". */
    provider: text("provider").notNull(),
    /** Id pesan dari penyedia — untuk mencocokkan dgn dashboard mereka. */
    providerMessageId: text("provider_message_id"),
    /** Pesan galat apa adanya dari penyedia; null kalau berhasil. */
    error: text("error"),
    bodyHtml: text("body_html"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Halaman log: terbaru dulu.
    index("idx_email_logs_created").on(t.createdAt),
    // Pencarian per penerima — pertanyaan tersering saat menelusuri keluhan.
    index("idx_email_logs_recipient").on(t.recipient),
    // Penyaringan "tampilkan yang gagal saja".
    index("idx_email_logs_status").on(t.status, t.createdAt),
  ]
);
