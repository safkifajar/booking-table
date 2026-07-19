/**
 * Urutan list sesi untuk dashboard KASIR & WAITER (arahan produk):
 * 1. BELUM LUNAS di atas (masih ada sisa tagihan / outstanding > 0);
 * 2. sisanya (sudah lunas / tanpa tagihan) dari tanggal TERBARU ke terlama.
 *
 * Di dalam tiap grup juga terbaru dulu, supaya yang baru masuk gampang
 * terlihat. Modul terpisah (bukan di *-actions.ts yang "use server") karena
 * Next.js melarang export non-async dari file server action.
 */

export interface SortableSession {
  outstanding: number;
  started_at: string;
  reservation_at?: string | null;
  closed_at?: string | null;
}

/** Patokan waktu: closed_at (kalau sudah tutup) → reservation_at → started_at. */
function sessionTimeOf(s: SortableSession): number {
  const iso = s.closed_at ?? s.reservation_at ?? s.started_at;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function sortUnpaidFirst<T extends SortableSession>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aUnpaid = a.outstanding > 0;
    const bUnpaid = b.outstanding > 0;
    if (aUnpaid !== bUnpaid) return aUnpaid ? -1 : 1;
    return sessionTimeOf(b) - sessionTimeOf(a);
  });
}
