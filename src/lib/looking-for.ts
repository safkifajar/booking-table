/**
 * Opsi "looking for" (tujuan di SOHO). Client-safe. Value cocok enum server.
 */

export const LOOKING_FOR_OPTIONS = [
  { value: "relationship", label: "Relationship" },
  { value: "casual", label: "Casual Date" },
  { value: "friendship", label: "Friendship" },
] as const;

export type LookingForValue = (typeof LOOKING_FOR_OPTIONS)[number]["value"];

/** Ubah value → label tampilan (null/tak dikenal → null). */
export function lookingForLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return LOOKING_FOR_OPTIONS.find((o) => o.value === value)?.label ?? null;
}
