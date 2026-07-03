/**
 * Prompt ice-breaker bertema social house SOHO (bukan dating) — pemantik obrolan
 * di venue. User pilih & isi jawaban, maks {@link MAX_PROMPTS}.
 *
 * Dipakai di onboarding (OnboardingWizard) dan form edit profil (ProfileForm)
 * supaya daftar prompt konsisten. Client-safe.
 */

export const PROMPT_OPTIONS = [
  "Tonight I'm in the mood for…",
  "My go-to order here is…",
  "You'll usually find me…",
  "The perfect night out is…",
  "Ask me about…",
  "I'll always say yes to…",
  "A little-known fact about me…",
  "My hidden talent is…",
  "On repeat right now…",
  "My karaoke go-to is…",
  "Let's talk about…",
  "The best way to break the ice with me…",
  "I'm here to…",
  "My kind of crowd is…",
];

export const MAX_PROMPTS = 5;
