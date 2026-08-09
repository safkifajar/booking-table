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
 * Email diisi user di halaman /auth/forgot lalu ikut terkirim di pesan, supaya
 * CS tak perlu bertanya ulang.
 */
export function waForgotPasswordUrl(email: string): string {
  const mail = email.trim();
  const text = [
    // Bahasa Indonesia
    "Halo SOHO Social House, saya lupa password akun saya.",
    "Mohon dibantu untuk reset password.",
    "",
    `Email akun saya: ${mail}`,
    "",
    "Terima kasih.",
    "",
    "-----------",
    "",
    // English
    "Hi SOHO Social House, I forgot my account password.",
    "Could you please help me reset it?",
    "",
    `My account email: ${mail}`,
    "",
    "Thank you.",
  ].join("\n");
  return `https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(text)}`;
}
