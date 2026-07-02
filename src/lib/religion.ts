/**
 * Opsi agama (opsional di profil). Client-safe.
 * Value disimpan ke profiles.religion (cocok enum server); label ditampilkan.
 * Daftar = 6 agama resmi Indonesia + "spiritual" (tak beragama/spiritual).
 */

export const RELIGION_OPTIONS = [
  { value: "islam", label: "Islam" },
  { value: "christian", label: "Kristen" },
  { value: "catholic", label: "Katolik" },
  { value: "hindu", label: "Hindu" },
  { value: "buddhist", label: "Buddha" },
  { value: "confucian", label: "Konghucu" },
  { value: "spiritual", label: "Spiritual but not religious" },
] as const;

export type ReligionValue = (typeof RELIGION_OPTIONS)[number]["value"];

/** Ubah value agama jadi label tampilan (null/tak dikenal → null). */
export function religionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return RELIGION_OPTIONS.find((o) => o.value === value)?.label ?? null;
}
