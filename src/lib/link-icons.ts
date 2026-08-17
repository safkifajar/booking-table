/**
 * Daftar ikon KURASI untuk tautan link-tree.
 *
 * Sengaja dibatasi (~30) alih-alih membuka seluruh ~1000 ikon lucide:
 * memuat semuanya menggembungkan bundle halaman admin, dan pilihan sebanyak
 * itu justru menyulitkan admin memilih. Yang di sini relevan untuk bar/venue.
 *
 * `value` disimpan ke DB (bar_links.icon) — JANGAN diubah setelah dipakai,
 * nanti ikon tautan yang sudah tersimpan hilang. Menambah baru aman.
 */
export const LINK_ICONS = [
  { value: "link", label: "Link" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "WhatsApp" },
  // lucide tak menyertakan logo brand → dua ini pakai ikon generik
  // (jempol & video). Labelnya tetap menyebut platformnya supaya admin tahu
  // peruntukannya.
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube / Video" },
  { value: "music", label: "Music" },
  { value: "map-pin", label: "Location" },
  { value: "phone", label: "Phone" },
  { value: "mail", label: "Email" },
  { value: "globe", label: "Website" },
  { value: "smartphone", label: "App" },
  { value: "utensils", label: "Menu / Food" },
  { value: "wine", label: "Drinks" },
  { value: "coffee", label: "Coffee" },
  { value: "calendar", label: "Reservation" },
  { value: "ticket", label: "Event / Ticket" },
  { value: "party-popper", label: "Party" },
  { value: "gift", label: "Promo / Gift" },
  { value: "star", label: "Featured" },
  { value: "crown", label: "Membership" },
  { value: "users", label: "Community" },
  { value: "camera", label: "Photos" },
  { value: "image", label: "Gallery" },
  { value: "shopping-bag", label: "Shop" },
  { value: "credit-card", label: "Payment" },
  { value: "briefcase", label: "Career" },
  { value: "file-text", label: "Info / Docs" },
  { value: "help-circle", label: "Help / FAQ" },
  { value: "clock", label: "Opening hours" },
  { value: "navigation", label: "Directions" },
] as const;

export type LinkIconName = (typeof LINK_ICONS)[number]["value"];

/** Nama ikon valid? Dipakai validasi server sebelum simpan. */
export function isLinkIcon(v: string): v is LinkIconName {
  return LINK_ICONS.some((i) => i.value === v);
}
