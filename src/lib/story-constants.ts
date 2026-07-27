/**
 * Konstanta story yang perlu dipakai lintas client & server. Dipisah dari
 * story-actions.ts (yang "use server" — tak boleh export non-async value).
 */

/** Warna latar yang diperbolehkan untuk story teks (harus cocok preset UI). */
export const STORY_TEXT_BG_COLORS = [
  "#e11d2a", // SOHO red
  "#0f172a", // slate dark
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#16a34a", // green
  "#ea580c", // orange
  "#1f2937", // neutral dark
] as const;

/** Gaya tipografi story teks (mirip tombol "Aa" di WhatsApp). */
export type StoryTextStyle = "classic" | "serif" | "mono" | "strong";

export const STORY_TEXT_STYLES: StoryTextStyle[] = [
  "classic",
  "serif",
  "mono",
  "strong",
];

/** Class Tailwind untuk tiap gaya (font-family + weight + tracking). */
export const STORY_TEXT_STYLE_CLASS: Record<StoryTextStyle, string> = {
  classic: "font-sans font-bold",
  serif: "font-serif font-semibold italic",
  mono: "font-mono font-semibold tracking-tight",
  strong: "font-sans font-extrabold uppercase tracking-wide",
};

/** Label pendek untuk tombol pemilih gaya. */
export const STORY_TEXT_STYLE_LABEL: Record<StoryTextStyle, string> = {
  classic: "Aa",
  serif: "Aa",
  mono: "Aa",
  strong: "AA",
};
