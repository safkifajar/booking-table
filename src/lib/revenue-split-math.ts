/**
 * Perhitungan MURNI bagi hasil service fee — tanpa database, tanpa
 * `server-only`.
 *
 * Dipisah dari revenue-split.ts supaya bisa diuji langsung: berkas itu
 * menandai dirinya server-only dan mengimpor klien database saat dimuat,
 * sehingga fungsi hitungnya ikut terkurung padahal tak menyentuh keduanya.
 *
 * Dipakai engine bagi hasil DAN simulasi di UI admin, jadi keduanya memakai
 * rumus yang sama persis.
 */

export interface SchemeCategory {
  name: string;
  percentMilli: number;
  method: string | null;
  isRemainderSink: boolean;
}

/**
 * Hitung pembagian.
 *
 * `base` = porsi SUBTOTAL sumber (bukan nominal payment yang sudah termasuk
 * tax & service) — konsisten dengan service% di Settings.
 * `serviceCollected` = service yang benar-benar terkumpul.
 *
 * Kategori penampung (sink) menyerap sisa & pembulatan, POSITIF ATAU MINUS.
 * Sink minus itu jujur, bukan cacat: mis. service dimatikan tapi fee channel
 * tetap jalan. Menjepitnya ke nol justru membuat uangnya tak seimbang.
 *
 * Jaminan: Σ hasil SELALU = serviceCollected (bila ada sink).
 */
export function computeSplit(input: {
  base: number;
  serviceCollected: number;
  method: string;
  categories: SchemeCategory[];
}): { category: string; amount: number }[] {
  const out: { category: string; amount: number }[] = [];
  let allocated = 0;
  let sink: string | null = null;
  for (const c of input.categories) {
    if (c.isRemainderSink) {
      sink = c.name;
      continue; // sink dihitung terakhir dari sisa
    }
    if (c.method != null && c.method !== input.method) continue;
    const amount = Math.round((input.base * c.percentMilli) / 100_000);
    out.push({ category: c.name, amount });
    allocated += amount;
  }
  if (sink) {
    // Sisa (positif/negatif) ke penampung — Σ selalu = serviceCollected.
    out.push({ category: sink, amount: input.serviceCollected - allocated });
  }
  return out;
}
