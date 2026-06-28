/**
 * Konstanta & tipe hobi (non-server). Master data hobi ada di DB (tabel hobbies),
 * dikelola admin lewat hobby-actions.ts. File ini cuma berisi opsi kategori &
 * tipe — aman di-import client/server.
 */

export const HOBBY_CATEGORY_OPTIONS = [
  "Musik & Hiburan",
  "Minuman & Kuliner",
  "Aktivitas Sosial",
  "Vibe & Gaya",
  "Lifestyle",
];

export interface HobbyItem {
  id: string;
  name: string;
  category: string;
  sort_order: number;
}

export interface HobbyGroup {
  category: string;
  items: HobbyItem[];
}
