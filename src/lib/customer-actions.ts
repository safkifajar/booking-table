"use server";

/**
 * Server Actions untuk admin manage customer (user non-staff).
 *
 * Customer = user yang TIDAK punya entry staff_roles. Staff dikelola di
 * halaman Manage Staff terpisah.
 *
 * Operations:
 * - listCustomers: list + search + pagination, dgn jumlah kunjungan (session)
 * - createCustomer: buat akun customer baru (nama + email + password)
 * - updateCustomer: ubah nama/email
 * - deleteCustomer: hapus akun — kalau punya history session, ditolak
 *   (cegah relasi rusak). Admin bisa biarkan saja akun itu.
 */

import { revalidatePath } from "next/cache";
import { and, eq, ilike, or, sql, desc, count, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { profiles } from "@/lib/db/schema/profiles";
import { staffRoles, memberRatings } from "@/lib/db/schema/extras";
import { friendships } from "@/lib/db/schema/friends";
import { membershipLevels } from "@/lib/db/schema/membership";
import {
  effectiveLevelKey,
  effectiveRank,
  getEffectiveRankOf,
  MEMBERSHIP_RANK,
  type MembershipKey,
} from "@/lib/membership";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { requireAdmin } from "@/lib/admin";
import { hashPassword } from "@/lib/auth-v2/password";
import {
  getBlockedIdSet,
  getFriendIdSet,
  getRelationshipMap,
} from "@/lib/friends";
import { getEffectiveRankMap, sqlEffectiveRank } from "@/lib/membership";
import { normalizeUsername } from "@/lib/utils";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import {
  getUserRatingsBatch,
  getBarBySlug,
  getActiveProfileIdsAtBar,
} from "@/lib/queries";
import type { NetworkMembersPage } from "@/types/db";

/** Umur dari ISO date "YYYY-MM-DD" (null kalau kosong/invalid). */
function ageFromISO(iso: string | null): number | null {
  if (!iso) return null;
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// ============================================================
// LIST
// ============================================================

export interface AdminCustomerRow {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  email: string;
  phone: string | null;
  gender: string | null;
  interested_in: string | null;
  birth_date: string | null;
  social_link: string | null;
  area: string | null;
  education: string | null;
  height_cm: number | null;
  religion: string | null;
  bio: string | null;
  is_guest: boolean;
  is_active: boolean;
  created_at: string;
  /** Jumlah session sbg member (kunjungan). */
  visit_count: number;
  /** Rata-rata rating diterima (0 = belum ada). */
  rating_avg: number;
  rating_count: number;
  /** Jumlah teman (PRD Friends req. i). */
  friend_count: number;
  /** Level membership EFEKTIF (PRD Membership M12). */
  membership_key: MembershipKey;
  membership_name: string;
}

export interface ListCustomersResult {
  rows: AdminCustomerRow[];
  total: number;
}

const PAGE_SIZE = 10;

/**
 * List customer (non-staff). Search by nama/email. Pagination.
 * Exclude user yg punya staff_role + exclude guest walk-in placeholder.
 */
export async function listCustomers(
  searchRaw?: string,
  page = 1,
  pageSize = PAGE_SIZE,
  filters?: {
    status?: "all" | "active" | "inactive";
    membership?: "all" | "basic" | "premium" | "vip";
    /** Urut kolom Visits. default = terbaru daftar (createdAt desc). */
    sort?: "default" | "visit_desc" | "visit_asc";
  }
): Promise<ListCustomersResult> {
  await requireAdmin();
  const search = (searchRaw ?? "").trim();
  const status = filters?.status ?? "all";
  const membership = filters?.membership ?? "all";
  const sort = filters?.sort ?? "default";
  // Clamp pageSize ke opsi valid (cegah abuse).
  const size = [10, 25, 50, 100].includes(pageSize) ? pageSize : PAGE_SIZE;

  // Subquery: profileId yang punya staff_role (untuk di-exclude).
  const staffIds = db
    .select({ id: staffRoles.profileId })
    .from(staffRoles);

  // Filter membership EFEKTIF di SQL (replika effectiveLevelKey): level yg
  // premium/vip TAPI sudah expired dihitung 'basic'. NULL expires_at = lifetime.
  const membershipClause =
    membership === "all"
      ? undefined
      : membership === "basic"
        ? sql`(${profiles.membershipLevel} = 'basic' OR (${profiles.membershipExpiresAt} IS NOT NULL AND ${profiles.membershipExpiresAt} <= now()))`
        : sql`(${profiles.membershipLevel} = ${membership} AND (${profiles.membershipExpiresAt} IS NULL OR ${profiles.membershipExpiresAt} > now()))`;

  const whereClause = and(
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
    status === "all" ? undefined : eq(profiles.isActive, status === "active"),
    membershipClause,
    search
      ? or(
          ilike(profiles.displayName, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(profiles.username, `%${search}%`)
        )
      : undefined
  );

  // Visit count subquery (session sbg member).
  const visitSq = db
    .select({
      profileId: sessionMembers.profileId,
      c: count(sessionMembers.id).as("c"),
    })
    .from(sessionMembers)
    .groupBy(sessionMembers.profileId)
    .as("visits");

  // Rating subquery (avg + count, dari review yg diterima).
  const ratingSq = db
    .select({
      rateeId: memberRatings.rateeId,
      avg: sql<number>`ROUND(AVG(${memberRatings.stars})::numeric, 1)`.as("avg"),
      cnt: count(memberRatings.id).as("cnt"),
    })
    .from(memberRatings)
    .groupBy(memberRatings.rateeId)
    .as("ratings");

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: users.id,
        name: profiles.displayName,
        username: profiles.username,
        avatar_url: profiles.avatarUrl,
        email: users.email,
        phone: profiles.phone,
        gender: profiles.gender,
        interested_in: profiles.interestedIn,
        birth_date: profiles.birthDate,
        social_link: profiles.socialLink,
        area: profiles.area,
        education: profiles.education,
        height_cm: profiles.heightCm,
        religion: profiles.religion,
        bio: profiles.bio,
        is_guest: profiles.isGuest,
        is_active: profiles.isActive,
        created_at: profiles.createdAt,
        membership_level: profiles.membershipLevel,
        membership_expires_at: profiles.membershipExpiresAt,
        visit_count: sql<number>`COALESCE(${visitSq.c}, 0)::int`,
        rating_avg: sql<number>`COALESCE(${ratingSq.avg}, 0)`,
        rating_count: sql<number>`COALESCE(${ratingSq.cnt}, 0)::int`,
        // Jumlah teman: friendships menyimpan SATU baris per pasangan (kanonik
        // user_a < user_b), jadi user bisa berada di kolom mana pun — hitung
        // kedua kolom. Ekspresi skalar berkorelasi (bukan join): tak ada alias
        // yang bisa bentrok dgn subquery visits/ratings yg sama-sama pakai "c".
        friend_count: sql<number>`(
          SELECT COUNT(*)::int FROM ${friendships} f
          WHERE f.user_a_id = ${users.id} OR f.user_b_id = ${users.id}
        )`,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.id, users.id))
      .leftJoin(visitSq, eq(visitSq.profileId, users.id))
      .leftJoin(ratingSq, eq(ratingSq.rateeId, users.id))
      .where(whereClause)
      .orderBy(
        sort === "visit_desc"
          ? sql`COALESCE(${visitSq.c}, 0) DESC`
          : sort === "visit_asc"
            ? sql`COALESCE(${visitSq.c}, 0) ASC`
            : desc(profiles.createdAt)
      )
      .limit(size)
      .offset((Math.max(1, page) - 1) * size),
    db
      .select({ total: count() })
      .from(users)
      .innerJoin(profiles, eq(profiles.id, users.id))
      .where(whereClause),
  ]);

  // Nama tampilan level (editable admin) — 3 baris, sekali ambil.
  const levelRows = await db
    .select({ key: membershipLevels.key, name: membershipLevels.name })
    .from(membershipLevels);
  const levelNames = new Map(levelRows.map((l) => [l.key, l.name]));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      username: r.username,
      avatar_url: r.avatar_url,
      email: r.email,
      phone: r.phone,
      gender: r.gender,
      interested_in: r.interested_in,
      birth_date: r.birth_date,
      social_link: r.social_link,
      area: r.area,
      education: r.education,
      height_cm: r.height_cm,
      religion: r.religion,
      bio: r.bio,
      is_guest: r.is_guest,
      is_active: r.is_active,
      created_at: r.created_at.toISOString(),
      visit_count: Number(r.visit_count),
      rating_avg: Number(r.rating_avg),
      rating_count: Number(r.rating_count),
      friend_count: Number(r.friend_count),
      membership_key: effectiveLevelKey(r.membership_level, r.membership_expires_at),
      membership_name:
        levelNames.get(
          effectiveLevelKey(r.membership_level, r.membership_expires_at)
        ) ?? "Basic",
    })),
    total: Number(totalRow[0]?.total ?? 0),
  };
}

export interface CustomerStats {
  total: number;
  active: number;
  inactive: number;
  basic: number;
  premium: number;
  vip: number;
}

/**
 * Statistik ringkas customer (non-staff, non-guest): total, per-status, dan
 * per-membership EFEKTIF (level yg expired dihitung basic). Satu query agregat
 * — hitungan menyeluruh (bukan cuma halaman aktif).
 */
export async function getCustomerStats(): Promise<CustomerStats> {
  await requireAdmin();
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  // Level efektif di SQL: premium/vip yg sudah lewat expires_at → basic.
  const eff = sql<string>`CASE
    WHEN ${profiles.membershipLevel} <> 'basic'
      AND ${profiles.membershipExpiresAt} IS NOT NULL
      AND ${profiles.membershipExpiresAt} <= now()
    THEN 'basic' ELSE ${profiles.membershipLevel} END`;

  const [row] = await db
    .select({
      total: count(),
      active: sql<number>`COUNT(*) FILTER (WHERE ${profiles.isActive})::int`,
      inactive: sql<number>`COUNT(*) FILTER (WHERE NOT ${profiles.isActive})::int`,
      basic: sql<number>`COUNT(*) FILTER (WHERE ${eff} = 'basic')::int`,
      premium: sql<number>`COUNT(*) FILTER (WHERE ${eff} = 'premium')::int`,
      vip: sql<number>`COUNT(*) FILTER (WHERE ${eff} = 'vip')::int`,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(
      and(
        sql`${users.id} NOT IN (${staffIds})`,
        eq(profiles.isGuest, false)
      )
    );
  return {
    total: Number(row?.total ?? 0),
    active: Number(row?.active ?? 0),
    inactive: Number(row?.inactive ?? 0),
    basic: Number(row?.basic ?? 0),
    premium: Number(row?.premium ?? 0),
    vip: Number(row?.vip ?? 0),
  };
}

/**
 * Baris export CSV — data diri LENGKAP per customer (termasuk hobi & minat).
 * Berbeda dari AdminCustomerRow yang dipakai list (ringkas): di sini semua
 * kolom biodata dibawa supaya export mencakup profil utuh.
 */
export interface ExportCustomerRow {
  name: string;
  username: string | null;
  email: string;
  phone: string | null;
  gender: string | null;
  interested_in: string | null;
  looking_for: string | null;
  birth_date: string | null;
  area: string | null;
  education: string | null;
  religion: string | null;
  height_cm: number | null;
  hobbies: string[];
  music_pref: string | null;
  fav_food: string | null;
  fav_drink: string | null;
  bio: string | null;
  social_link: string | null;
  visit_count: number;
  friend_count: number;
  rating_avg: number;
  rating_count: number;
  membership_name: string;
  is_active: boolean;
  created_at: string;
}

/**
 * Export SEMUA customer (bukan cuma halaman aktif) sesuai filter yang sedang
 * dipakai (search/status/membership). Membawa data diri lengkap termasuk
 * hobi & ketertarikan untuk keperluan CSV. Urut: terbaru daftar dulu.
 */
export async function exportCustomers(
  searchRaw?: string,
  filters?: {
    status?: "all" | "active" | "inactive";
    membership?: "all" | "basic" | "premium" | "vip";
  }
): Promise<ExportCustomerRow[]> {
  await requireAdmin();
  const search = (searchRaw ?? "").trim();
  const status = filters?.status ?? "all";
  const membership = filters?.membership ?? "all";

  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  const membershipClause =
    membership === "all"
      ? undefined
      : membership === "basic"
        ? sql`(${profiles.membershipLevel} = 'basic' OR (${profiles.membershipExpiresAt} IS NOT NULL AND ${profiles.membershipExpiresAt} <= now()))`
        : sql`(${profiles.membershipLevel} = ${membership} AND (${profiles.membershipExpiresAt} IS NULL OR ${profiles.membershipExpiresAt} > now()))`;

  const whereClause = and(
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
    status === "all" ? undefined : eq(profiles.isActive, status === "active"),
    membershipClause,
    search
      ? or(
          ilike(profiles.displayName, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(profiles.username, `%${search}%`)
        )
      : undefined
  );

  const visitSq = db
    .select({
      profileId: sessionMembers.profileId,
      c: count(sessionMembers.id).as("c"),
    })
    .from(sessionMembers)
    .groupBy(sessionMembers.profileId)
    .as("visits");

  const ratingSq = db
    .select({
      rateeId: memberRatings.rateeId,
      avg: sql<number>`ROUND(AVG(${memberRatings.stars})::numeric, 1)`.as("avg"),
      cnt: count(memberRatings.id).as("cnt"),
    })
    .from(memberRatings)
    .groupBy(memberRatings.rateeId)
    .as("ratings");

  const rows = await db
    .select({
      name: profiles.displayName,
      username: profiles.username,
      email: users.email,
      phone: profiles.phone,
      gender: profiles.gender,
      interested_in: profiles.interestedIn,
      looking_for: profiles.lookingFor,
      birth_date: profiles.birthDate,
      area: profiles.area,
      education: profiles.education,
      religion: profiles.religion,
      height_cm: profiles.heightCm,
      hobbies: profiles.hobbies,
      music_pref: profiles.musicPref,
      fav_food: profiles.favFood,
      fav_drink: profiles.favDrink,
      bio: profiles.bio,
      social_link: profiles.socialLink,
      is_active: profiles.isActive,
      created_at: profiles.createdAt,
      membership_level: profiles.membershipLevel,
      membership_expires_at: profiles.membershipExpiresAt,
      visit_count: sql<number>`COALESCE(${visitSq.c}, 0)::int`,
      rating_avg: sql<number>`COALESCE(${ratingSq.avg}, 0)`,
      rating_count: sql<number>`COALESCE(${ratingSq.cnt}, 0)::int`,
      friend_count: sql<number>`(
        SELECT COUNT(*)::int FROM ${friendships} f
        WHERE f.user_a_id = ${users.id} OR f.user_b_id = ${users.id}
      )`,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .leftJoin(visitSq, eq(visitSq.profileId, users.id))
    .leftJoin(ratingSq, eq(ratingSq.rateeId, users.id))
    .where(whereClause)
    .orderBy(desc(profiles.createdAt));

  // Nama tampilan level (editable admin).
  const levelRows = await db
    .select({ key: membershipLevels.key, name: membershipLevels.name })
    .from(membershipLevels);
  const levelNames = new Map(levelRows.map((l) => [l.key, l.name]));

  return rows.map((r) => ({
    name: r.name,
    username: r.username,
    email: r.email,
    phone: r.phone,
    gender: r.gender,
    interested_in: r.interested_in,
    looking_for: r.looking_for,
    birth_date: r.birth_date,
    area: r.area,
    education: r.education,
    religion: r.religion,
    height_cm: r.height_cm,
    hobbies: r.hobbies ?? [],
    music_pref: r.music_pref,
    fav_food: r.fav_food,
    fav_drink: r.fav_drink,
    bio: r.bio,
    social_link: r.social_link,
    visit_count: Number(r.visit_count),
    friend_count: Number(r.friend_count),
    rating_avg: Number(r.rating_avg),
    rating_count: Number(r.rating_count),
    membership_name:
      levelNames.get(
        effectiveLevelKey(r.membership_level, r.membership_expires_at)
      ) ?? "Basic",
    is_active: r.is_active,
    created_at: r.created_at.toISOString(),
  }));
}

// ============================================================
// CREATE
// ============================================================

/**
 * Field profil opsional yang bisa diisi admin saat create/update customer.
 * Disamakan dengan yang ada di form edit profil (ProfileForm) supaya data
 * konsisten. Foto/prompts/interests sengaja tak di sini — lebih pas diisi
 * user sendiri (butuh upload/picker).
 */
const profileFields = {
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
    .enum([
      "high_school",
      "diploma",
      "bachelor",
      "master",
      "doctorate",
      "other",
    ])
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
function profileValues(data: {
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
 * Validasi + cek unik username (admin create/update). Return normalized value
 * atau null (kalau kosong = tak diset). Throw kalau format salah / sudah dipakai.
 */
async function resolveUsername(
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

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  email: z.string().email("Invalid email").max(120),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  ...profileFields,
});

export async function createCustomer(input: z.infer<typeof createSchema>) {
  await requireAdmin();
  const data = createSchema.parse(input);
  const email = data.email.trim().toLowerCase();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw new Error("Email is already registered");

  const username = await resolveUsername(data.username);
  const passwordHash = await hashPassword(data.password);

  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        email,
        name: data.name,
        passwordHash,
        emailVerified: new Date(),
      })
      .returning({ id: users.id });
    await tx.insert(profiles).values({
      id: u.id,
      displayName: data.name,
      username,
      ...profileValues(data),
    });
  });

  revalidatePath("/admin/users");
}

// ============================================================
// UPDATE
// ============================================================

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  email: z.string().email().max(120),
  /** Password baru (opsional) — kalau diisi, reset password customer. */
  password: z.string().min(6, "Password must be at least 6 characters").max(100).optional(),
  /** Status aktif. false = tak bisa login. */
  isActive: z.boolean(),
  ...profileFields,
});

export async function updateCustomer(input: z.infer<typeof updateSchema>) {
  await requireAdmin();
  const data = updateSchema.parse(input);
  const email = data.email.trim().toLowerCase();

  // Pastikan bukan staff (cuma boleh edit customer dari sini).
  const [staff] = await db
    .select({ id: staffRoles.profileId })
    .from(staffRoles)
    .where(eq(staffRoles.profileId, data.id));
  if (staff) throw new Error("This user is staff — manage them in Manage Staff");

  // Email unik (kecuali milik sendiri).
  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), sql`${users.id} <> ${data.id}`));
  if (clash) throw new Error("Email is already used by another user");

  // Username: validasi + cek unik (kecuali milik sendiri). Kosong = tak diubah.
  const username = await resolveUsername(data.username, data.id);

  // Reset password kalau diisi.
  const passwordHash = data.password
    ? await hashPassword(data.password)
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email,
        name: data.name,
        ...(passwordHash ? { passwordHash } : {}),
      })
      .where(eq(users.id, data.id));
    await tx
      .update(profiles)
      .set({
        displayName: data.name,
        isActive: data.isActive,
        ...(username !== null ? { username } : {}),
        ...profileValues(data),
      })
      .where(eq(profiles.id, data.id));
  });

  revalidatePath("/admin/users");
}

// ============================================================
// SET PASSWORD (admin reset password customer)
// ============================================================

const setPasswordSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
});

export async function setCustomerPassword(
  input: z.infer<typeof setPasswordSchema>
) {
  await requireAdmin();
  const data = setPasswordSchema.parse(input);

  // Pastikan target bukan staff.
  const [staff] = await db
    .select({ id: staffRoles.profileId })
    .from(staffRoles)
    .where(eq(staffRoles.profileId, data.id));
  if (staff) throw new Error("This user is staff — manage them in Manage Staff");

  const passwordHash = await hashPassword(data.password);
  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, data.id));

  revalidatePath("/admin/users");
}

// ============================================================
// DELETE
// ============================================================

export async function deleteCustomer(id: string) {
  await requireAdmin();

  // Jangan hapus staff dari sini.
  const [staff] = await db
    .select({ id: staffRoles.profileId })
    .from(staffRoles)
    .where(eq(staffRoles.profileId, id));
  if (staff) throw new Error("This user is staff — manage them in Manage Staff");

  // Cek history: kalau pernah jadi member session ATAU host session, tolak
  // (cegah relasi rusak). Admin bisa biarkan akun-nya.
  const [asMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(eq(sessionMembers.profileId, id))
    .limit(1);
  const [asHost] = await db
    .select({ id: tableSessions.id })
    .from(tableSessions)
    .where(eq(tableSessions.hostId, id))
    .limit(1);
  if (asMember || asHost) {
    throw new Error(
      "This customer has visit history — can't be deleted (to preserve transaction data)."
    );
  }

  // Aman dihapus: profile dulu (FK), lalu user.
  await db.transaction(async (tx) => {
    await tx.delete(profiles).where(eq(profiles.id, id));
    await tx.delete(users).where(eq(users.id, id));
  });

  revalidatePath("/admin/users");
}

// ============================================================
// SEARCH KANDIDAT UNDANGAN (publik — utk ajak/undang ke meja)
// ============================================================

export interface InviteCandidate {
  id: string;
  name: string;
  email: string;
  /** Username unik (handle) — tampil di picker undangan. */
  username: string | null;
  /** Level membership EFEKTIF — badge di picker (permintaan user rev-2). */
  membership_key: MembershipKey;
  membership_name: string;
}

/**
 * Cari user yg bisa diajak/diundang ke meja. PUBLIK (auth = user login,
 * bukan admin). Kandidat: customer non-staff, non-guest, BUKAN diri sendiri,
 * bukan yg saling blokir (PRD Friends K6b).
 *
 * friendsOnly (PRD K2, mode auto-join "friends"): kandidat dibatasi TEMAN saja.
 * Query tetap WAJIB min 1 char di kedua mode — daftar tak pernah di-dump
 * (juga bukan daftar teman: itu membocorkan lingkar pertemanan ke pemanggil
 * devtools tanpa perlu).
 */
export async function searchInviteCandidates(
  queryRaw: string,
  excludeSessionId?: string,
  opts?: { friendsOnly?: boolean }
): Promise<InviteCandidate[]> {
  const me = await getCurrentProfile();
  if (!me) return [];
  const q = (queryRaw ?? "").trim();
  const friendsOnly = opts?.friendsOnly === true;
  if (q.length < 1) return [];

  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  const conditions = [
    sql`${users.id} <> ${me.id}`,
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
    or(ilike(profiles.displayName, `%${q}%`), ilike(users.email, `%${q}%`))!,
  ];
  if (friendsOnly) {
    const friendIds = await getFriendIdSet(me.id);
    if (friendIds.size === 0) return [];
    conditions.push(inArray(users.id, [...friendIds]));
  } else {
    // Teman tak mungkin saling blokir (blockUser auto-unfriend), jadi saringan
    // blokir hanya perlu di jalur non-friendsOnly.
    const hiddenIds = await getBlockedIdSet(me.id);
    if (hiddenIds.size > 0) {
      const elems = sql.join(
        [...hiddenIds].map((id) => sql`${id}::uuid`),
        sql`, `
      );
      conditions.push(sql`${users.id} NOT IN (${elems})`);
    }
  }

  // Saat dipanggil dari session (ajak/undang): sembunyikan user yg SUDAH jadi
  // member meja itu (joined/pending). Yg pernah left/kicked tetap muncul supaya
  // bisa diundang ulang.
  if (excludeSessionId) {
    const memberIds = db
      .select({ id: sessionMembers.profileId })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, excludeSessionId),
          inArray(sessionMembers.status, ["joined", "pending"])
        )
      );
    conditions.push(sql`${users.id} NOT IN (${memberIds})`);
  }

  // Over-fetch lalu saring KUNCI LEVEL di JS (PRD Membership M6): kandidat =
  // level <= level pengundang, KECUALI teman (selalu boleh). friendsOnly
  // sudah pasti teman → lolos tanpa cek rank.
  const rows = await db
    .select({
      id: users.id,
      name: profiles.displayName,
      email: users.email,
      username: profiles.username,
      membership_level: profiles.membershipLevel,
      membership_expires_at: profiles.membershipExpiresAt,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(and(...conditions))
    .orderBy(profiles.displayName)
    .limit(30);

  let allowed = rows;
  if (!friendsOnly && rows.length > 0) {
    const [viewerRank, rankMap, friendIds] = await Promise.all([
      getEffectiveRankOf(me.id),
      getEffectiveRankMap(rows.map((r) => r.id)),
      getFriendIdSet(me.id),
    ]);
    allowed = rows.filter(
      (r) =>
        friendIds.has(r.id) ||
        (rankMap.get(r.id) ?? MEMBERSHIP_RANK.basic) <= viewerRank
    );
  }

  // Nama level (editable admin) utk badge picker.
  const levelRowsPick = await db
    .select({ key: membershipLevels.key, name: membershipLevels.name })
    .from(membershipLevels);
  const levelNamesPick = new Map(levelRowsPick.map((l) => [l.key, l.name]));

  return allowed.slice(0, 10).map((r) => {
    const key = effectiveLevelKey(r.membership_level, r.membership_expires_at);
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      username: r.username,
      membership_key: key,
      membership_name: levelNamesPick.get(key) ?? key,
    };
  });
}

// ============================================================
// MEMBER NETWORK (daftar semua member + search, di halaman /network)
// ============================================================

const MEMBERS_PAGE_SIZE = 15;

/**
 * Daftar SEMUA member SOHO (customer non-staff, non-guest, kecuali diri sendiri)
 * untuk tab "Semua member" di /network. Paginated keyset (infinite scroll):
 * urut displayName ASC, id ASC sebagai tie-break. Cursor = "<displayName>
<id>"
 * dari baris terakhir halaman sebelumnya. Optional filter by nama/email.
 */
export async function listAllMembers(opts?: {
  query?: string;
  cursor?: string | null;
  hobbies?: string[];
  /** Ketertarikan viewer — prioritaskan gender ini di urutan (male/female). */
  interestedIn?: "male" | "female" | "both" | "";
}): Promise<NetworkMembersPage> {
  const me = await getCurrentProfile();
  if (!me) return { users: [], next_cursor: null };

  const q = (opts?.query ?? "").trim();
  const hobbies = (opts?.hobbies ?? []).filter((h) => h.trim().length > 0);
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  // Prioritas gender: 0 = gender cocok interestedIn (tampil dulu), 1 = sisanya.
  // both/"" → semua priority 0 (urut biasa).
  const wantGender =
    opts?.interestedIn === "male" || opts?.interestedIn === "female"
      ? opts.interestedIn
      : null;
  const priorityExpr = wantGender
    ? sql<number>`CASE WHEN ${profiles.gender} = ${wantGender} THEN 0 ELSE 1 END`
    : sql<number>`0`;
  // Urutan level: VIP → Premium → Basic (rank efektif DESC). Dinegasikan
  // supaya tuple-compare keyset tetap ASC seragam.
  const tierExpr = sql<number>`-(${sqlEffectiveRank()})`;

  const conditions = [
    sql`${users.id} <> ${me.id}`,
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
  ];
  // Blokir (arah mana pun) -> saling hilang dari daftar (PRD Friends 7.2 C1).
  const hiddenIds = await getBlockedIdSet(me.id);
  if (hiddenIds.size > 0) {
    const elems = sql.join(
      Array.from(hiddenIds).map((id) => sql`${id}::uuid`),
      sql`, `
    );
    conditions.push(sql`${users.id} NOT IN (${elems})`);
  }
  if (q.length >= 1) {
    conditions.push(
      or(ilike(profiles.displayName, `%${q}%`), ilike(users.email, `%${q}%`))!
    );
  }
  if (hobbies.length > 0) {
    const elems = sql.join(
      hobbies.map((h) => sql`${h}`),
      sql`, `
    );
    conditions.push(sql`${profiles.hobbies} && ARRAY[${elems}]::text[]`);
  }
  // Keyset: baris SETELAH (tier, priority, displayName, id) terakhir.
  // Cursor = "<tier>\n<priority>\n<displayName>\n<id>". Tuple compare jaga
  // urutan konsisten lintas grup saat infinite scroll. (Rank yg berubah di
  // tengah scroll — mis. kedaluwarsa — bisa menggeser baris; diterima, sama
  // seperti prioritas gender.)
  if (opts?.cursor) {
    const parts = opts.cursor.split("\n");
    if (parts.length === 4) {
      const [cTierStr, cPrioStr, cName, cId] = parts;
      const cTier = Number(cTierStr);
      const cPrio = Number(cPrioStr);
      conditions.push(
        sql`(${tierExpr}, ${priorityExpr}, ${profiles.displayName}, ${users.id}) > (${cTier}, ${cPrio}, ${cName}, ${cId})`
      );
    }
  }

  const rows = await db
    .select({
      id: users.id,
      display_name: profiles.displayName,
      username: profiles.username,
      avatar_url: profiles.avatarUrl,
      photos: profiles.photos,
      gender: profiles.gender,
      birth_date: profiles.birthDate,
      area: profiles.area,
      education: profiles.education,
      hide_age: profiles.hideAge,
      hide_location: profiles.hideLocation,
      hobbies: profiles.hobbies,
      membership_level: profiles.membershipLevel,
      membership_expires_at: profiles.membershipExpiresAt,
      priority: priorityExpr,
      tier: tierExpr,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(and(...conditions))
    .orderBy(tierExpr, priorityExpr, profiles.displayName, users.id)
    .limit(MEMBERS_PAGE_SIZE + 1);

  const hasMore = rows.length > MEMBERS_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, MEMBERS_PAGE_SIZE) : rows;

  // Badge "At SOHO now": set profile_id yg sedang nongkrong di bar default.
  const bar = await getBarBySlug(
    process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto"
  );
  const activeIds = bar
    ? await getActiveProfileIdsAtBar(bar.id)
    : new Set<string>();

  const ratings = await getUserRatingsBatch(pageRows.map((r) => r.id));
  // Status relasi pertemanan per kartu — SATU batch query, bukan per baris
  // (PRD Friends 10.4).
  const relationships = await getRelationshipMap(
    me.id,
    pageRows.map((r) => r.id)
  );
  // Kunci level (PRD Membership M4/M5): viewer melihat level-nya & di bawah;
  // TEMAN selalu terbuka (G2). Rank target dihitung dari kolom yg sudah
  // di-select (tanpa query tambahan); rank viewer satu query.
  const viewerRank = await getEffectiveRankOf(me.id);
  const levelRowsAll = await db
    .select({ key: membershipLevels.key, name: membershipLevels.name })
    .from(membershipLevels);
  const levelNamesAll = new Map(levelRowsAll.map((l) => [l.key, l.name]));
  const last = pageRows[pageRows.length - 1];
  return {
    users: pageRows.map((r) => {
      const targetKey = effectiveLevelKey(
        r.membership_level,
        r.membership_expires_at
      );
      const isFriend = relationships.get(r.id) === "friends";
      const locked = !isFriend && MEMBERSHIP_RANK[targetKey] > viewerRank;
      return {
        id: r.id,
        // Terkunci → identitas TIDAK dikirim (kartu blur anonim); cursor
        // keyset tetap aman — dibangun dari baris mentah, bukan hasil map.
        display_name: locked ? "SOHO member" : r.display_name,
        username: locked ? null : r.username,
        avatar_url: r.avatar_url,
        photos: r.photos ?? [],
        // Privasi: hormati hide_age / hide_location. Terkunci level →
        // detail TIDAK dikirim ke client sama sekali (bukan blur CSS).
        age: locked || r.hide_age ? null : ageFromISO(r.birth_date),
        area: locked || r.hide_location ? null : r.area,
        education: locked ? null : r.education,
        gender: locked ? null : r.gender,
        at_soho: activeIds.has(r.id), // badge At SOHO TETAP terlihat (M5)
        hobbies: locked ? [] : r.hobbies,
        rating: locked
          ? { avg_stars: 0, rating_count: 0, top_tags: null }
          : (ratings[r.id] ?? { avg_stars: 0, rating_count: 0, top_tags: null }),
        friend_status: relationships.get(r.id) ?? "none",
        membership_key: targetKey,
        membership_name: levelNamesAll.get(targetKey) ?? targetKey,
        locked,
      };
    }),
    next_cursor:
      hasMore && last
        ? `${last.tier}\n${last.priority}\n${last.display_name}\n${last.id}`
        : null,
  };
}
