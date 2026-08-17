/**
 * Kontak WhatsApp CS — dipakai tombol "Contact us" di /auth, /profile, dan
 * pengajuan lupa password.
 *
 * Nomornya kini DIATUR ADMIN (Settings → Contact), tersimpan di
 * bars.contact_wa. Fungsi di sini menerima nomor sebagai argumen supaya
 * komponen client tak perlu membaca DB — halaman server yang mengambilnya
 * lalu mengalirkannya lewat props.
 *
 * CONTACT_WA_FALLBACK dipakai kalau admin belum mengisi: env
 * NEXT_PUBLIC_CONTACT_WA, atau nomor bawaan. Jadi perilaku lama tetap jalan
 * dan tombol CS tak pernah menuju nomor kosong.
 *
 * Format nomor: 62... (tanpa + / spasi), sesuai wa.me.
 */
export const CONTACT_WA_FALLBACK =
  process.env.NEXT_PUBLIC_CONTACT_WA ?? "6281228814542";

/**
 * Rapikan input admin jadi format wa.me:
 * "0812-3456 789" → "62123456789", "+62812..." → "62812...".
 * Kosong/tak masuk akal → null (pemanggil pakai fallback).
 */
export function normalizeWaNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Buang semua kecuali angka (spasi, tanda hubung, tanda plus, tanda kurung).
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  // 0812... → 62812... (nomor lokal Indonesia)
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  // 8xx... tanpa awalan apa pun → anggap Indonesia
  else if (d.startsWith("8")) d = `62${d}`;
  // Terlalu pendek untuk nomor sungguhan → tolak, jangan bikin tautan rusak.
  if (d.length < 9) return null;
  return d;
}

/** Nomor efektif: punya bar kalau ada & valid, kalau tidak fallback. */
export function resolveWa(barWa?: string | null): string {
  return normalizeWaNumber(barWa) ?? CONTACT_WA_FALLBACK;
}

/** URL wa.me + teks pembuka (opsional). */
export function waUrl(
  barWa?: string | null,
  text = "Hi SOHO Social House, I'd like to ask about "
): string {
  return `https://wa.me/${resolveWa(barWa)}?text=${encodeURIComponent(text)}`;
}

/**
 * URL WhatsApp untuk PENGAJUAN RESET PASSWORD ke CS (diproses admin).
 * Email diisi user di halaman /auth/forgot lalu ikut terkirim di pesan, supaya
 * CS tak perlu bertanya ulang.
 */
export function waForgotPasswordUrl(
  email: string,
  barWa?: string | null
): string {
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
  return `https://wa.me/${resolveWa(barWa)}?text=${encodeURIComponent(text)}`;
}
