import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema/profiles";
import { normalizeUsername } from "@/lib/utils";

/**
 * Field profil customer yang dipakai bersama oleh admin (customer-actions) dan
 * kasir (staff-customer-actions). Dipisah ke modul non-"use server" karena file
 * server-action hanya boleh meng-export async function.
 */
export const profileFields = {
  /** Username unik (opsional saat create/update — kosong = tak set/ubah). */
  username: z.string().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .optional()
    .or(z.literal("")),
  gender: z.enum(["male", "female"]).optional().or(z.literal("")),
  interestedIn: z.enum(["male", "female", "both"]).optional().or(z.literal("")),
  socialLink: z.string().max(200).optional().or(z.literal("")),
  area: z.string().max(120).optional().or(z.literal("")),
  education: z
    .enum(["high_school", "diploma", "bachelor", "master", "doctorate", "other"])
    .optional()
    .or(z.literal("")),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  religion: z
    .enum([
      "islam",
      "christian",
      "catholic",
      "hindu",
      "buddhist",
      "confucian",
      "spiritual",
    ])
    .optional()
    .or(z.literal("")),
  bio: z.string().max(280).optional().or(z.literal("")),
};

/** Field profil → nilai untuk .set()/.values() (normalisasi trim/null). */
export function profileValues(data: {
  phone?: string;
  birthDate?: string;
  gender?: string;
  interestedIn?: string;
  socialLink?: string;
  area?: string;
  education?: string;
  heightCm?: number | null;
  religion?: string;
  bio?: string;
}) {
  return {
    phone: data.phone?.trim() || null,
    birthDate: data.birthDate || null,
    gender: data.gender || null,
    interestedIn: data.interestedIn || null,
    socialLink: data.socialLink?.trim() || null,
    area: data.area || null,
    education: data.education || null,
    heightCm: data.heightCm ?? null,
    religion: data.religion || null,
    bio: data.bio?.trim() || null,
  };
}

/**
 * Validasi + cek unik username. Return normalized value atau null (kosong =
 * tak diset). Throw kalau format salah / sudah dipakai.
 */
export async function resolveUsername(
  raw: string | undefined,
  excludeId?: string
): Promise<string | null> {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const u = normalizeUsername(trimmed);
  if (!u.ok) throw new Error(u.error);
  const [clash] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      excludeId
        ? and(eq(profiles.username, u.value), sql`${profiles.id} <> ${excludeId}`)
        : eq(profiles.username, u.value)
    );
  if (clash) throw new Error("Username already taken");
  return u.value;
}
