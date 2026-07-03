/**
 * Tipe hobi (non-server). Master data hobi & kategori ada di DB (tabel hobbies,
 * hobby_categories), dikelola admin lewat hobby-actions.ts. File ini cuma tipe —
 * aman di-import client/server.
 */

export interface HobbyItem {
  id: string;
  name: string;
  category: string;
  /** Emoji di depan nama (opsional). */
  emoji: string | null;
  sort_order: number;
}

export interface HobbyGroup {
  category: string;
  items: HobbyItem[];
}

export interface HobbyCategory {
  id: string;
  name: string;
  sort_order: number;
}
