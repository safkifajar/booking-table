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
import { staffRoles } from "@/lib/db/schema/extras";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { requireAdmin } from "@/lib/admin";
import { hashPassword } from "@/lib/auth-v2/password";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getUserRatingsBatch } from "@/lib/queries";
import type { NetworkMembersPage } from "@/types/db";

// ============================================================
// LIST
// ============================================================

export interface AdminCustomerRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  is_guest: boolean;
  created_at: string;
  /** Jumlah session sbg member (kunjungan). */
  visit_count: number;
}

export interface ListCustomersResult {
  rows: AdminCustomerRow[];
  total: number;
}

const PAGE_SIZE = 20;

/**
 * List customer (non-staff). Search by nama/email. Pagination.
 * Exclude user yg punya staff_role + exclude guest walk-in placeholder.
 */
export async function listCustomers(
  searchRaw?: string,
  page = 1
): Promise<ListCustomersResult> {
  await requireAdmin();
  const search = (searchRaw ?? "").trim();

  // Subquery: profileId yang punya staff_role (untuk di-exclude).
  const staffIds = db
    .select({ id: staffRoles.profileId })
    .from(staffRoles);

  const whereClause = and(
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
    search
      ? or(
          ilike(profiles.displayName, `%${search}%`),
          ilike(users.email, `%${search}%`)
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

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: users.id,
        name: profiles.displayName,
        email: users.email,
        phone: profiles.phone,
        is_guest: profiles.isGuest,
        created_at: profiles.createdAt,
        visit_count: sql<number>`COALESCE(${visitSq.c}, 0)::int`,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.id, users.id))
      .leftJoin(visitSq, eq(visitSq.profileId, users.id))
      .where(whereClause)
      .orderBy(desc(profiles.createdAt))
      .limit(PAGE_SIZE)
      .offset((Math.max(1, page) - 1) * PAGE_SIZE),
    db
      .select({ total: count() })
      .from(users)
      .innerJoin(profiles, eq(profiles.id, users.id))
      .where(whereClause),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      is_guest: r.is_guest,
      created_at: r.created_at.toISOString(),
      visit_count: Number(r.visit_count),
    })),
    total: Number(totalRow[0]?.total ?? 0),
  };
}

// ============================================================
// CREATE
// ============================================================

const createSchema = z.object({
  name: z.string().min(1, "Nama wajib").max(80),
  email: z.string().email("Email tidak valid").max(120),
  password: z.string().min(6, "Password minimal 6 karakter").max(100),
  phone: z.string().max(20).optional(),
});

export async function createCustomer(input: z.infer<typeof createSchema>) {
  await requireAdmin();
  const data = createSchema.parse(input);
  const email = data.email.trim().toLowerCase();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw new Error("Email sudah terdaftar");

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
      phone: data.phone?.trim() || null,
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
  phone: z.string().max(20).optional(),
  /** Password baru (opsional) — kalau diisi, reset password customer. */
  password: z.string().min(6, "Password minimal 6 karakter").max(100).optional(),
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
  if (staff) throw new Error("User ini staff — kelola di Manage Staff");

  // Email unik (kecuali milik sendiri).
  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), sql`${users.id} <> ${data.id}`));
  if (clash) throw new Error("Email sudah dipakai user lain");

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
      .set({ displayName: data.name, phone: data.phone?.trim() || null })
      .where(eq(profiles.id, data.id));
  });

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
  if (staff) throw new Error("User ini staff — kelola di Manage Staff");

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
      "Customer ini punya riwayat kunjungan — tidak bisa dihapus (jaga data transaksi)."
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
}

/**
 * Cari user yg bisa diajak/diundang ke meja. PUBLIK (auth = user login,
 * bukan admin). Kandidat: customer non-staff, non-guest, BUKAN diri sendiri.
 * Wajib ada query (min 1 char) supaya tidak dump semua user.
 */
export async function searchInviteCandidates(
  queryRaw: string,
  excludeSessionId?: string
): Promise<InviteCandidate[]> {
  const me = await getCurrentProfile();
  if (!me) return [];
  const q = (queryRaw ?? "").trim();
  if (q.length < 1) return [];

  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  const conditions = [
    sql`${users.id} <> ${me.id}`,
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
    or(ilike(profiles.displayName, `%${q}%`), ilike(users.email, `%${q}%`)),
  ];

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

  const rows = await db
    .select({
      id: users.id,
      name: profiles.displayName,
      email: users.email,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(and(...conditions))
    .orderBy(profiles.displayName)
    .limit(10);

  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
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
}): Promise<NetworkMembersPage> {
  const me = await getCurrentProfile();
  if (!me) return { users: [], next_cursor: null };

  const q = (opts?.query ?? "").trim();
  const hobbies = (opts?.hobbies ?? []).filter((h) => h.trim().length > 0);
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);

  const conditions = [
    sql`${users.id} <> ${me.id}`,
    sql`${users.id} NOT IN (${staffIds})`,
    eq(profiles.isGuest, false),
  ];
  if (q.length >= 1) {
    conditions.push(
      or(ilike(profiles.displayName, `%${q}%`), ilike(users.email, `%${q}%`))!
    );
  }
  // Filter hobi: user punya MINIMAL SATU dari hobi terpilih (array overlap &&).
  // Bangun ARRAY['a','b',...]::text[] dgn tiap nilai sbg parameter terpisah.
  if (hobbies.length > 0) {
    const elems = sql.join(
      hobbies.map((h) => sql`${h}`),
      sql`, `
    );
    conditions.push(sql`${profiles.hobbies} && ARRAY[${elems}]::text[]`);
  }
  // Keyset: ambil baris SETELAH cursor (displayName, id) terakhir. Pemisah
  // cursor = "\n" — display_name bisa berisi spasi, jadi spasi tak bisa jadi
  // pemisah; id (uuid) tak mengandung newline.
  if (opts?.cursor) {
    const sep = opts.cursor.indexOf("\n");
    if (sep >= 0) {
      const cName = opts.cursor.slice(0, sep);
      const cId = opts.cursor.slice(sep + 1);
      conditions.push(
        sql`(${profiles.displayName}, ${users.id}) > (${cName}, ${cId})`
      );
    }
  }

  const rows = await db
    .select({
      id: users.id,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
      hobbies: profiles.hobbies,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(and(...conditions))
    .orderBy(profiles.displayName, users.id)
    .limit(MEMBERS_PAGE_SIZE + 1);

  // Ambil 1 lebih untuk tahu apakah masih ada halaman berikutnya.
  const hasMore = rows.length > MEMBERS_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, MEMBERS_PAGE_SIZE) : rows;

  const ratings = await getUserRatingsBatch(pageRows.map((r) => r.id));
  const last = pageRows[pageRows.length - 1];
  return {
    users: pageRows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      hobbies: r.hobbies,
      rating: ratings[r.id] ?? { avg_stars: 0, rating_count: 0, top_tags: null },
    })),
    next_cursor:
      hasMore && last ? `${last.display_name}\n${last.id}` : null,
  };
}
