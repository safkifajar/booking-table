/**
 * Ukuran meja (px kanvas) otomatis dari kapasitas + bentuk — tidak perlu input
 * manual. Round/square ~kotak; rect/booth memanjang horizontal (2 baris kursi).
 *
 * Client-safe (dipakai form editor) + dipanggil server action saat simpan.
 */
export function tableSize(
  shape: "round" | "square" | "rect" | "booth",
  capacity: number
): { width: number; height: number } {
  const cap = Math.max(1, Math.min(50, capacity));
  if (shape === "round" || shape === "square") {
    const side = Math.round(Math.min(180, Math.max(60, 44 + cap * 9)));
    return { width: side, height: side };
  }
  // rect / booth: 2 baris kursi → lebar ikut setengah kapasitas.
  const perRow = Math.ceil(cap / 2);
  const width = Math.round(Math.min(360, Math.max(80, 40 + perRow * 34)));
  const height = Math.round(shape === "booth" ? 90 : 70);
  return { width, height };
}
