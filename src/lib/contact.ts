/**
 * Kontak resmi SOHO Social House (dipakai tombol "Contact us" / "Hubungi CS"
 * di /auth dan /profile). Sekali ganti di sini, berlaku di semua tempat.
 *
 * Format nomor: 62... (tanpa tanda + / spasi), sesuai wa.me.
 * Bisa dioverride lewat env NEXT_PUBLIC_CONTACT_WA saat deploy.
 *
 * TODO: ganti default dengan nomor WhatsApp asli SOHO.
 */
export const CONTACT_WA =
  process.env.NEXT_PUBLIC_CONTACT_WA ?? "6281234567890";

/** URL wa.me + teks pembuka (opsional). */
export function waUrl(text = "Hi SOHO Social House, saya mau bertanya "): string {
  return `https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(text)}`;
}
