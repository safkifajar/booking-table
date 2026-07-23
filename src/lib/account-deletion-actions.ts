"use server";

import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { accountDeletionRequests } from "@/lib/db/schema/account-deletion";
import { profiles } from "@/lib/db/schema/profiles";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile, requireAdmin } from "@/lib/auth-v2/current";
import { createNotification } from "@/lib/notifications";
import { revalidatePath } from "next/cache";

const requestSchema = z.object({
  reason: z.string().trim().min(3, "Please tell us why (min 3 characters)").max(500),
});

/**
 * Customer mengajukan hapus akun (soft-delete via approval admin).
 *
 * GUARD (arahan produk):
 *  - Alasan WAJIB (min 3 char).
 *  - Tak boleh kalau masih punya SESI AKTIF (member 'joined' di sesi
 *    reserved/open/locked) ATAU TAGIHAN belum lunas — cegah kabur dari
 *    tanggungan. Sejajar dgn guard leaveSession/closeSession.
 *  - Anti-dobel: satu pengajuan pending per user (conditional insert).
 * Approve/reject dilakukan admin (resolveAccountDeletion).
 */
export async function requestAccountDeletion(input: {
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireProfile();
  // Guard yang bisa terjadi normal (sudah pending / masih ada sesi) dikembalikan
  // sebagai { ok:false, error } — BUKAN throw — supaya pesannya sampai utuh ke
  // customer (throw di server-action disensor jadi "Server Components render"
  // di production build).
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reason",
    };
  }
  const { reason } = parsed.data;

  // Sudah ada pengajuan pending? → jangan dobel.
  const [existing] = await db
    .select({ id: accountDeletionRequests.id })
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.requestedBy, profile.id),
        eq(accountDeletionRequests.status, "pending")
      )
    )
    .limit(1);
  if (existing) {
    return { ok: false, error: "You already have a pending deletion request." };
  }

  // Guard: sesi aktif (member joined di sesi belum selesai).
  const activeSessions = await db
    .select({ id: tableSessions.id })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .where(
      and(
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined"),
        inArray(tableSessions.status, ["reserved", "open", "locked", "overdue"])
      )
    );
  // Member 'joined' di sesi reserved/open/locked/overdue = masih terlibat meja
  // (atau nunggak) → tahan pengajuan.
  if (activeSessions.length > 0) {
    return {
      ok: false,
      error:
        "You have an active table or unpaid bill. Please finish or settle it before requesting account deletion.",
    };
  }

  const [req] = await db
    .insert(accountDeletionRequests)
    .values({ requestedBy: profile.id, reason, status: "pending" })
    .returning({ id: accountDeletionRequests.id });

  // Kabari semua admin/manager aktif (in-app + push).
  const admins = await db
    .selectDistinct({ profileId: staffRoles.profileId })
    .from(staffRoles)
    .where(
      and(
        inArray(staffRoles.role, ["admin", "manager"]),
        eq(staffRoles.isActive, true)
      )
    );
  // Notif admin — best-effort, TAK boleh menggagalkan pengajuan yang sudah
  // tersimpan (catch menyeluruh, bukan cuma per-item).
  try {
    await Promise.allSettled(
      admins.map((a) =>
        createNotification({
          profileId: a.profileId,
          type: "general",
          title: "Account deletion request",
          body: `${profile.displayName} requested to delete their account.`,
          link: "/admin/account-deletions",
          refId: req.id,
        })
      )
    );
  } catch (e) {
    console.error("[account-deletion] notify admins:", e);
  }

  revalidatePath("/profile");
  return { ok: true };
}

/** Baris pengajuan hapus akun untuk panel admin. */
export interface AccountDeletionRequestItem {
  id: string;
  status: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  requester_id: string;
  requester_name: string;
  requester_avatar: string | null;
  requester_email: string | null;
  resolver_name: string | null;
}

/**
 * Daftar pengajuan hapus akun (admin). Pending dulu, lalu terbaru. Admin-only.
 */
export async function getAccountDeletionRequests(): Promise<
  AccountDeletionRequestItem[]
> {
  await requireAdmin();
  const requester = profiles;
  const rows = await db
    .select({
      id: accountDeletionRequests.id,
      status: accountDeletionRequests.status,
      reason: accountDeletionRequests.reason,
      created_at: accountDeletionRequests.createdAt,
      resolved_at: accountDeletionRequests.resolvedAt,
      requester_id: accountDeletionRequests.requestedBy,
      requester_name: requester.displayName,
      requester_avatar: requester.avatarUrl,
      resolver_id: accountDeletionRequests.resolvedBy,
    })
    .from(accountDeletionRequests)
    .innerJoin(requester, eq(requester.id, accountDeletionRequests.requestedBy))
    // Pending dulu, lalu terbaru.
    .orderBy(
      sql`CASE WHEN ${accountDeletionRequests.status} = 'pending' THEN 0 ELSE 1 END`,
      desc(accountDeletionRequests.createdAt)
    );
  if (rows.length === 0) return [];

  // Email requester (dari users, 1-1 dgn profiles) + nama resolver.
  const { users } = await import("@/lib/db/schema/auth");
  const requesterIds = rows.map((r) => r.requester_id);
  const emailRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, requesterIds));
  const emailMap = new Map(emailRows.map((e) => [e.id, e.email]));

  const resolverIds = rows
    .map((r) => r.resolver_id)
    .filter((id): id is string => !!id);
  const resolverMap = new Map<string, string>();
  if (resolverIds.length > 0) {
    const rp = await db
      .select({ id: profiles.id, name: profiles.displayName })
      .from(profiles)
      .where(inArray(profiles.id, resolverIds));
    for (const r of rp) resolverMap.set(r.id, r.name);
  }

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    created_at: r.created_at.toISOString(),
    resolved_at: r.resolved_at ? r.resolved_at.toISOString() : null,
    requester_id: r.requester_id,
    requester_name: r.requester_name,
    requester_avatar: r.requester_avatar,
    requester_email: emailMap.get(r.requester_id) ?? null,
    resolver_name: r.resolver_id ? resolverMap.get(r.resolver_id) ?? null : null,
  }));
}

const resolveSchema = z.object({
  requestId: z.string().uuid(),
  approve: z.boolean(),
});

/**
 * Admin approve/reject pengajuan hapus akun.
 *  - approve → SOFT DELETE: profiles.is_active=false (akun tak bisa login;
 *    session hidup diputus via guard isActive di getCurrentProfile). Data tetap.
 *  - reject  → tutup pengajuan, akun normal.
 * Notif ke pemohon. Conditional (WHERE status='pending') → tak dobel-proses.
 */
export async function resolveAccountDeletion(input: {
  requestId: string;
  approve: boolean;
}): Promise<{ ok: true }> {
  const ctx = await requireAdmin();
  const { requestId, approve } = resolveSchema.parse(input);

  const [req] = await db
    .select({
      id: accountDeletionRequests.id,
      status: accountDeletionRequests.status,
      requestedBy: accountDeletionRequests.requestedBy,
    })
    .from(accountDeletionRequests)
    .where(eq(accountDeletionRequests.id, requestId));
  if (!req) throw new Error("Request not found");
  if (req.status !== "pending") {
    throw new Error("This request has already been processed.");
  }

  // Transisi conditional pending→final (idempoten thd klik ganda).
  const updated = await db
    .update(accountDeletionRequests)
    .set({
      status: approve ? "approved" : "rejected",
      resolvedBy: ctx.profile.id,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(accountDeletionRequests.id, requestId),
        eq(accountDeletionRequests.status, "pending")
      )
    )
    .returning({ id: accountDeletionRequests.id });
  if (updated.length === 0) {
    throw new Error("This request has already been processed.");
  }

  if (approve) {
    // SOFT DELETE — nonaktifkan akun. Login berikutnya ditolak (credentials.ts);
    // session hidup diputus oleh guard isActive di getCurrentProfile.
    await db
      .update(profiles)
      .set({ isActive: false })
      .where(eq(profiles.id, req.requestedBy));
  }

  // Kabari pemohon hasil pengajuan. (skipPush tidak — biar dapat push juga.)
  await createNotification({
    profileId: req.requestedBy,
    type: "general",
    title: approve ? "Account deletion approved" : "Account deletion declined",
    body: approve
      ? "Your account has been deactivated. Contact an admin if this was a mistake."
      : "Your account deletion request was declined. Your account stays active.",
    refId: requestId,
  });

  revalidatePath("/admin/account-deletions");
  return { ok: true };
}
