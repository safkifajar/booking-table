import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/**
 * Guard anti-tumpang-tindih untuk cron.
 *
 * Masalah yang diselesaikan: cron dijadwalkan berkala (mis. tiap 5 menit).
 * Kalau satu kali jalan belum selesai saat jadwal berikutnya menyala, dua
 * proses mengerjakan pekerjaan yang sama bersamaan — memboroskan DB dan
 * (tanpa penanda anti-dobel) bisa mengirim notifikasi ganda.
 *
 * Memakai Postgres advisory lock, BUKAN flag di tabel. Alasannya: lock
 * otomatis lepas kalau koneksi mati / proses crash. Flag di tabel akan
 * menggantung "sedang jalan" selamanya dan menghentikan cron permanen —
 * kegagalan yang jauh lebih buruk daripada tumpang-tindih.
 *
 * Diverifikasi: koneksi kedua mendapat false saat koneksi pertama masih
 * memegang lock, dan lock lepas sendiri saat transaksi selesai.
 */

/** ID lock per jenis pekerjaan. Angka bebas, asal tak bertabrakan. */
export const CRON_LOCK = {
  bookingReminder: 919_001,
  bannerNotify: 919_002,
} as const;

/**
 * Jalankan `fn` HANYA kalau tak ada proses lain yang sedang memegang lock
 * yang sama. Kalau sedang dipegang → return `{ skipped: true }` tanpa
 * menjalankan apa pun.
 *
 * Lock dipegang selama transaksi berlangsung & lepas otomatis di akhir —
 * termasuk kalau `fn` melempar error.
 */
export async function withCronLock<T>(
  lockId: number,
  fn: () => Promise<T>
): Promise<{ skipped: true } | { skipped: false; result: T }> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${lockId}) AS locked`
    );
    const locked = (rows as unknown as { locked: boolean }[])[0]?.locked;
    if (!locked) {
      console.warn("[cron-lock] proses lain masih jalan, dilewati:", lockId);
      return { skipped: true } as const;
    }
    const result = await fn();
    return { skipped: false as const, result };
  });
}
