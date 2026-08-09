"use server";

/**
 * Server Actions "kelola pelanggan" untuk STAFF (kasir/manager/admin).
 *
 * Berbeda dari customer-actions.ts yang di-guard requireAdmin (kasir ditolak),
 * modul ini di-guard permission `manage_customers` supaya kasir bisa:
 * - cari & lihat pelanggan
 * - menambah pelanggan (mis. tamu yang tak bawa HP) — password default dibuat
 *   sistem lalu ditampilkan sekali ke kasir untuk diberikan ke pelanggan
 * - mengubah data pelanggan
 *
 * Guest walk-in (profiles.isGuest = true) & staff TIDAK termasuk "pelanggan".
 */

import { revalidatePath } from "next/cache";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { profiles } from "@/lib/db/schema/profiles";
import { staffRoles } from "@/lib/db/schema/extras";
import { sessionMembers } from "@/lib/db/schema/sessions";
import { membershipLevels } from "@/lib/db/schema/membership";
import { requirePermission } from "@/lib/auth-v2/permissions";
import { hashPassword } from "@/lib/auth-v2/password";
import {
  profileFields,
  profileValues,
  resolveUsername,
} from "@/lib/customer-fields";
import { effectiveLevelKey } from "@/lib/membership";
import { logActivity } from "@/lib/activity-log";

const GUARD_PATH = "/staff/cashier/customers";

// ============================================================
// LIST / SEARCH
// ============================================================

export interface StaffCustomerRow {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  email: string;
  phone: string | null;
  is_active: boolean;
  visit_count: number;
  membership_name: string;
  created_at: string;
}

export interface StaffCustomerListResult {
  rows: StaffCustomerRow[];
  total: number;
}

const PAGE_SIZE = 20;

/**
 * List/cari pelanggan untuk staff. Search by nama / username / email / no. HP.
 * Exclude staff & guest walk-in. Terbaru daftar di atas.
 */
export async function listCustomersForStaff(
  searchRaw?: string,
  page = 1,
  pageSize = PAGE_SIZE
): Promise<StaffCustomerListResult> {
  await requirePermission("manage_customers", GUARD_PATH);

  const search = (searchRaw ?? "").trim();
  const size = [10, 20, 50].includes(pageSize) ? pageSize : PAGE_SIZE;
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  const whereClause = and(
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
    search
      ? or(
          ilike(profiles.displayName, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(profiles.username, `%${search}%`),
          ilike(profiles.phone, `%${search}%`)
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

  const [rows, totalRow, levelRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: profiles.displayName,
        username: profiles.username,
        avatar_url: profiles.avatarUrl,
        email: users.email,
        phone: profiles.phone,
        is_active: profiles.isActive,
        created_at: profiles.createdAt,
        membership_level: profiles.membershipLevel,
        membership_expires_at: profiles.membershipExpiresAt,
        visit_count: sql<number>`COALESCE(${visitSq.c}, 0)::int`,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.id, users.id))
      .leftJoin(visitSq, eq(visitSq.profileId, users.id))
      .where(whereClause)
      .orderBy(desc(profiles.createdAt))
      .limit(size)
      .offset((Math.max(1, page) - 1) * size),
    db
      .select({ total: count() })
      .from(users)
      .innerJoin(profiles, eq(profiles.id, users.id))
      .where(whereClause),
    db
      .select({ key: membershipLevels.key, name: membershipLevels.name })
      .from(membershipLevels),
  ]);

  const levelNames = new Map(levelRows.map((l) => [l.key, l.name]));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      username: r.username,
      avatar_url: r.avatar_url,
      email: r.email,
      phone: r.phone,
      is_active: r.is_active,
      visit_count: Number(r.visit_count),
      membership_name:
        levelNames.get(
          effectiveLevelKey(r.membership_level, r.membership_expires_at)
        ) ?? "Basic",
      created_at: r.created_at.toISOString(),
    })),
    total: Number(totalRow[0]?.total ?? 0),
  };
}

/** Detail satu pelanggan untuk form edit di kasir. */
export interface StaffCustomerDetail {
  id: string;
  name: string;
  username: string | null;
  email: string;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  interestedIn: string | null;
  area: string | null;
  education: string | null;
  heightCm: number | null;
  religion: string | null;
  socialLink: string | null;
  bio: string | null;
  isActive: boolean;
}

export async function getCustomerForStaff(
  id: string
): Promise<StaffCustomerDetail | null> {
  await requirePermission("manage_customers", GUARD_PATH);

  const [row] = await db
    .select({
      id: users.id,
      name: profiles.displayName,
      username: profiles.username,
      email: users.email,
      phone: profiles.phone,
      birthDate: profiles.birthDate,
      gender: profiles.gender,
      interestedIn: profiles.interestedIn,
      area: profiles.area,
      education: profiles.education,
      heightCm: profiles.heightCm,
      religion: profiles.religion,
      socialLink: profiles.socialLink,
      bio: profiles.bio,
      isActive: profiles.isActive,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(and(eq(users.id, id), eq(profiles.isGuest, false)));
  return row ?? null;
}

/**
 * Cari pelanggan untuk dipilih sebagai pemilik meja di form Open Table.
 * Di-guard `open_table_for_customer` supaya WAITER (yang tak boleh mengelola
 * akun pelanggan) tetap bisa memilih pelanggan saat membuka meja.
 * Hasil ringkas & dibatasi 8 baris — hanya untuk picker.
 */
export async function searchCustomersForTableHost(
  queryRaw: string
): Promise<CustomerTableHost[]> {
  await requirePermission("open_table_for_customer", "/staff/open-table");

  const q = queryRaw.trim();
  if (q.length < 1) return [];
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  const rows = await db
    .select({
      id: profiles.id,
      name: profiles.displayName,
      phone: profiles.phone,
      username: profiles.username,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(
      and(
        sql`${users.id} NOT IN (${staffIds})`,
        eq(profiles.isGuest, false),
        eq(profiles.isActive, true),
        or(
          ilike(profiles.displayName, `%${q}%`),
          ilike(users.email, `%${q}%`),
          ilike(profiles.username, `%${q}%`),
          ilike(profiles.phone, `%${q}%`)
        )
      )
    )
    .orderBy(desc(profiles.createdAt))
    .limit(8);

  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone }));
}

/**
 * Data ringkas pelanggan untuk dipakai sebagai HOST meja (dari menu Customers
 * → "Open table"). NULL kalau bukan akun pelanggan yang sah (guest walk-in,
 * staff, atau nonaktif) supaya form open-table tak menerima host tak valid.
 */
export interface CustomerTableHost {
  id: string;
  name: string;
  phone: string | null;
}

export async function getCustomerAsTableHost(
  id: string
): Promise<CustomerTableHost | null> {
  // Guard buka-meja (bukan manage_customers) supaya waiter juga bisa memakai.
  await requirePermission("open_table_for_customer", "/staff/open-table");

  const [row] = await db
    .select({
      id: profiles.id,
      name: profiles.displayName,
      phone: profiles.phone,
      isGuest: profiles.isGuest,
      isActive: profiles.isActive,
    })
    .from(profiles)
    .where(eq(profiles.id, id));
  if (!row || row.isGuest || !row.isActive) return null;

  const [isStaff] = await db
    .select({ id: staffRoles.profileId })
    .from(staffRoles)
    .where(eq(staffRoles.profileId, id));
  if (isStaff) return null;

  return { id: row.id, name: row.name, phone: row.phone };
}

// ============================================================
// CREATE (password default dibuat sistem)
// ============================================================

/**
 * Password default: "soho" + 4 digit terakhir nomor HP (mudah disebutkan ke
 * pelanggan). Kalau HP tak punya 4 digit, pakai 4 digit acak supaya tetap ada
 * password yang valid. Pelanggan diminta menggantinya setelah login.
 */
function defaultPasswordFrom(phone: string | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const tail =
    digits.length >= 4
      ? digits.slice(-4)
      : String(Math.floor(1000 + Math.random() * 9000));
  return `soho${tail}`;
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  email: z.string().email("Invalid email").max(120),
  ...profileFields,
});

export interface CreateCustomerByStaffResult {
  id: string;
  email: string;
  username: string | null;
  /** Password default plaintext — HANYA dikembalikan sekali untuk diberikan ke pelanggan. */
  password: string;
}

export async function createCustomerByStaff(
  input: z.infer<typeof createSchema>
): Promise<CreateCustomerByStaffResult> {
  const ctx = await requirePermission("manage_customers", GUARD_PATH);
  const data = createSchema.parse(input);

  const email = data.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw new Error("Email is already registered");

  const username = await resolveUsername(data.username);
  const password = defaultPasswordFrom(data.phone);
  const passwordHash = await hashPassword(password);

  let newId = "";
  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        email,
        name: data.name,
        passwordHash,
        emailVerified: new Date(), // dibuat staff → dianggap terverifikasi
      })
      .returning({ id: users.id });
    await tx.insert(profiles).values({
      id: u.id,
      displayName: data.name,
      username,
      ...profileValues(data),
    });
    newId = u.id;
  });

  // Audit: staff membuat akun pelanggan (password default dibuat sistem).
  // Password TIDAK ikut dicatat.
  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "customer.created",
    category: "customer",
    summary: `Added customer ${data.name}`,
    entityType: "customer",
    entityId: newId,
    meta: { email, username },
  });

  revalidatePath("/staff/cashier/customers");
  revalidatePath("/admin/users");

  return { id: newId, email, username, password };
}

// ============================================================
// UPDATE
// ============================================================

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(80),
  email: z.string().email("Invalid email").max(120),
  ...profileFields,
});

export async function updateCustomerByStaff(
  input: z.infer<typeof updateSchema>
): Promise<void> {
  const ctx = await requirePermission("manage_customers", GUARD_PATH);
  const data = updateSchema.parse(input);

  // Jangan sentuh akun staff dari menu pelanggan.
  const [staff] = await db
    .select({ id: staffRoles.profileId })
    .from(staffRoles)
    .where(eq(staffRoles.profileId, data.id));
  if (staff) throw new Error("This user is staff. Manage them in Manage Staff");

  const email = data.email.trim().toLowerCase();
  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), sql`${users.id} <> ${data.id}`));
  if (clash) throw new Error("Email is already registered");

  const username = await resolveUsername(data.username, data.id);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ email, name: data.name })
      .where(eq(users.id, data.id));
    await tx
      .update(profiles)
      .set({
        displayName: data.name,
        ...(username ? { username } : {}),
        ...profileValues(data),
      })
      .where(eq(profiles.id, data.id));
  });

  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "customer.updated",
    category: "customer",
    summary: `Updated customer ${data.name}`,
    entityType: "customer",
    entityId: data.id,
    meta: { email },
  });

  revalidatePath("/staff/cashier/customers");
  revalidatePath("/admin/users");
}

// Catatan: reset/ubah password pelanggan TIDAK disediakan di sisi kasir —
// hanya admin (setCustomerPassword di customer-actions.ts). Kasir hanya melihat
// password default sekali saat membuat akun baru.
