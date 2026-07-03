/**
 * Katalog minat (interests) untuk onboarding — CMB-style "What do you like?".
 * Bertema social house SOHO (bukan dating). English + emoji, dikelompokkan per
 * kategori. Nilai yg disimpan ke profiles.hobbies = string `name` (tanpa emoji).
 *
 * Client-safe (tak ada server import). Sengaja hardcode di sini supaya punya
 * kontrol penuh atas emoji + label + urutan (master DB `hobbies` lama masih
 * Bahasa Indonesia & tanpa emoji).
 */

export interface InterestItem {
  /** Nilai yg disimpan (harus stabil — jangan diubah setelah dipakai). */
  name: string;
  /** Emoji ditampilkan di depan label. */
  emoji: string;
}

export interface InterestGroup {
  category: string;
  items: InterestItem[];
}

/** Maks minat yg boleh dipilih (ala CMB). */
export const MAX_INTERESTS = 8;

export const INTEREST_CATALOG: InterestGroup[] = [
  {
    category: "Food & Drink",
    items: [
      { name: "Cocktails", emoji: "🍸" },
      { name: "Wine", emoji: "🍷" },
      { name: "Craft beer", emoji: "🍺" },
      { name: "Whiskey", emoji: "🥃" },
      { name: "Coffee", emoji: "☕" },
      { name: "Mixology", emoji: "🧪" },
      { name: "Foodie", emoji: "😋" },
      { name: "Barbecue", emoji: "🍖" },
      { name: "Sushi", emoji: "🍣" },
      { name: "Ramen", emoji: "🍜" },
      { name: "Pizza", emoji: "🍕" },
      { name: "Tacos", emoji: "🌮" },
      { name: "Desserts", emoji: "🍫" },
      { name: "Shisha", emoji: "💨" },
      { name: "Tea", emoji: "🍵" },
      { name: "Vegan", emoji: "🌱" },
    ],
  },
  {
    category: "Music",
    items: [
      { name: "Live music", emoji: "🎤" },
      { name: "DJ sets", emoji: "🎧" },
      { name: "House", emoji: "🎵" },
      { name: "EDM", emoji: "🎵" },
      { name: "Hip-hop", emoji: "🎵" },
      { name: "R&B", emoji: "🎵" },
      { name: "Jazz", emoji: "🎷" },
      { name: "Indie", emoji: "🎸" },
      { name: "Rock", emoji: "🎸" },
      { name: "Pop", emoji: "🎵" },
      { name: "Techno", emoji: "🎛️" },
      { name: "Vinyl", emoji: "💿" },
      { name: "K-pop", emoji: "🎵" },
      { name: "Latin", emoji: "🎵" },
    ],
  },
  {
    category: "Going Out",
    items: [
      { name: "Grabbing a drink", emoji: "🥂" },
      { name: "Nightclubs", emoji: "🪩" },
      { name: "Karaoke", emoji: "🎤" },
      { name: "Concerts", emoji: "🎟️" },
      { name: "Festivals", emoji: "🎉" },
      { name: "Comedy shows", emoji: "🎙️" },
      { name: "Cafe-hopping", emoji: "☕" },
      { name: "Dining out", emoji: "🍽️" },
      { name: "Trivia", emoji: "🧠" },
      { name: "Open mic", emoji: "🎤" },
    ],
  },
  {
    category: "Games & Play",
    items: [
      { name: "Billiard", emoji: "🎱" },
      { name: "Darts", emoji: "🎯" },
      { name: "Board games", emoji: "♟️" },
      { name: "Video games", emoji: "🎮" },
      { name: "Poker", emoji: "🃏" },
      { name: "Watch parties", emoji: "📺" },
    ],
  },
  {
    category: "Sports & Fitness",
    items: [
      { name: "Gym", emoji: "💪" },
      { name: "Football", emoji: "⚽" },
      { name: "Basketball", emoji: "🏀" },
      { name: "Running", emoji: "🏃" },
      { name: "Cycling", emoji: "🚴" },
      { name: "Yoga", emoji: "🧘" },
      { name: "Boxing", emoji: "🥊" },
      { name: "Swimming", emoji: "🏊" },
      { name: "Climbing", emoji: "🧗" },
      { name: "Tennis", emoji: "🎾" },
    ],
  },
  {
    category: "Culture & Creativity",
    items: [
      { name: "Photography", emoji: "📷" },
      { name: "Art", emoji: "🎨" },
      { name: "Fashion", emoji: "👗" },
      { name: "Design", emoji: "✨" },
      { name: "Movies", emoji: "🎬" },
      { name: "Anime", emoji: "🌸" },
      { name: "Reading", emoji: "📚" },
      { name: "Dance", emoji: "💃" },
      { name: "Plays instrument", emoji: "🎹" },
      { name: "Singing", emoji: "🎙️" },
      { name: "Tattoos", emoji: "⚓" },
      { name: "Writing", emoji: "✏️" },
    ],
  },
  {
    category: "Lifestyle",
    items: [
      { name: "Travel", emoji: "✈️" },
      { name: "Big cities", emoji: "🏙️" },
      { name: "Beach", emoji: "🏖️" },
      { name: "Road trips", emoji: "🛣️" },
      { name: "Networking", emoji: "🤝" },
      { name: "Meeting new people", emoji: "👋" },
      { name: "Entrepreneurship", emoji: "🚀" },
      { name: "Wellness", emoji: "🌿" },
      { name: "Pets", emoji: "🐾" },
      { name: "Volunteering", emoji: "💗" },
    ],
  },
];

/** Map nama minat → emoji (flatten katalog), untuk tampilan chip di profil. */
const INTEREST_EMOJI: Record<string, string> = Object.fromEntries(
  INTEREST_CATALOG.flatMap((g) => g.items.map((i) => [i.name, i.emoji]))
);

/**
 * Emoji untuk satu nama minat. Return "" kalau tak dikenal (mis. hobi lama dari
 * master DB yg bukan bagian katalog) — caller tampilkan tanpa emoji.
 */
export function interestEmoji(name: string): string {
  return INTEREST_EMOJI[name] ?? "";
}
