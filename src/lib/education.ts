/**
 * Opsi pendidikan terakhir (opsional di profil). Client-safe.
 * Value disimpan ke profiles.education (cocok enum server); label ditampilkan.
 */

export const EDUCATION_OPTIONS = [
  { value: "high_school", label: "High school" },
  { value: "diploma", label: "Diploma / D3" },
  { value: "bachelor", label: "Bachelor's (S1)" },
  { value: "master", label: "Master's (S2)" },
  { value: "doctorate", label: "Doctorate / PhD (S3)" },
  { value: "other", label: "Other" },
] as const;

export type EducationValue = (typeof EDUCATION_OPTIONS)[number]["value"];

/** Ubah value pendidikan jadi label tampilan (null/tak dikenal → null). */
export function educationLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return EDUCATION_OPTIONS.find((o) => o.value === value)?.label ?? null;
}
