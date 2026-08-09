/**
 * Kontak resmi SOHO Social House (dipakai tombol "Contact us" / "Hubungi CS"
 * di /auth dan /profile). Sekali ganti di sini, berlaku di semua tempat.
 *
 * Format nomor: 62... (tanpa tanda + / spasi), sesuai wa.me.
 * Bisa dioverride lewat env NEXT_PUBLIC_CONTACT_WA saat deploy.
 *
 * Default = nomor WhatsApp resmi SOHO (081228814542 → 6281228814542).
 */
export const CONTACT_WA =
  process.env.NEXT_PUBLIC_CONTACT_WA ?? "6281228814542";

/** URL wa.me + teks pembuka (opsional). */
export function waUrl(text = "Hi SOHO Social House, I'd like to ask about "): string {
  return `https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(text)}`;
}

/**
 * URL WhatsApp untuk PENGAJUAN RESET PASSWORD ke CS (diproses admin).
 * Pesannya sudah berisi kerangka data yang dibutuhkan admin — email/no HP yang
 * sudah diketik user di form ikut terisi supaya CS tak perlu bertanya ulang.
 */
export function waForgotPasswordUrl(identifier?: string): string {
  const filled = identifier?.trim() ?? "";
  const text = [
    "Halo SOHO Social House, saya lupa password akun saya.",
    "Mohon dibantu untuk reset password.",
    "",
    "Data akun saya:",
    `- Email / No. HP: ${filled || "(mohon diisi)"}`,
    "- Nama akun: (mohon diisi)",
    "",
    "Terima kasih.",
  ].join("\n");
  return `https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(text)}`;
}
