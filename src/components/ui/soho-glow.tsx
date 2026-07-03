/**
 * SohoGlow — glow merah maroon SOHO (spotlight moody nightclub) di belakang
 * konten. Fixed di viewport, memancar dari tengah layar, memudar ke background.
 * pointer-events-none supaya tak ganggu klik. Reusable di halaman mana pun.
 *
 * Pakai: taruh sebagai anak pertama di dalam elemen `relative` (mis. <main
 * className="relative">). Warna dari brand SOHO (--primary merah + --brand maroon).
 */
export function SohoGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        background:
          "radial-gradient(55% 45% at 50% 50%, rgba(225,29,42,0.22), rgba(122,31,31,0.10) 45%, transparent 72%), radial-gradient(75% 55% at 50% 50%, rgba(122,31,31,0.26), transparent 65%)",
      }}
    />
  );
}
