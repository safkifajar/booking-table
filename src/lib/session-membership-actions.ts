"use server";

/**
 * Server Actions KEANGGOTAAN SESI — bergabung, undangan, keluar, tutup meja.
 *
 * (Di actions.ts bagian ini bernama "EDIT INFO MEJA", tapi isinya sebagian
 * besar soal keanggotaan; hanya updateSessionInfo yang benar-benar mengubah
 * info meja.)
 *
 * Dipisah mengikuti pola cashier-actions, waiter-actions & membership-actions
 * yang sudah ada. actions.ts MENERUSKAN ekspornya supaya berkas yang sudah
 * mengimpor dari sana tak perlu disentuh.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias as aliasedTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
  sessionInvites,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { requireProfile } from "@/lib/auth-v2/current";
import {
  notifySessionAndStaff,
  recordSessionInvites,
  markSessionInviteResponded,
} from "@/lib/session-shared";
import {
  createNotification,
  markInviteResponded,
  markInviteCancelled,
} from "@/lib/notifications";
import {
  areFriends,
  isBlockedEitherWay,
  getBlockedIdSet,
  getFriendIdSet,
} from "@/lib/friends";
import {
  getEffectiveRankOf,
  getEffectiveRankMap,
  MEMBERSHIP_RANK,
} from "@/lib/membership";
import { getOutstandingMap } from "@/lib/queries";
import { tableInviteEmail } from "@/lib/auth-v2/email-template";
import { sendEmail } from "@/lib/auth-v2/email-service";

/** Skema id sesi — dipakai beberapa aksi di berkas ini. */
const joinSchema = z.object({
  sessionId: z.string().uuid(),
});


const updateSessionInfoSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().max(80).nullable().optional(),
  visibility: z.enum(["public", "friends", "invite_only"]).optional(),
  vibeTags: z.array(z.string()).max(5).optional(),
});

/**
 * Edit informasi meja (session). Boleh: HOST meja atau STAFF (kasir/waiter).
 * Field: title (deskripsi), visibility, vibeTags. Jam booking TIDAK diubah di
 * sini (fixed setelah dibuat).
 */
export async function updateSessionInfo(
  input: z.infer<typeof updateSessionInfoSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireProfile();
  const data = updateSessionInfoSchema.parse(input);

  // 1. Ambil session (host + status utk otorisasi).
  const [row] = await db
    .select({
      id: tableSessions.id,
      host_id: tableSessions.hostId,
    })
    .from(tableSessions)
    .where(eq(tableSessions.id, data.sessionId));
  if (!row) throw new Error("Session not found");

  // 2. Otorisasi: host ATAU staff aktif.
  const isHost = row.host_id === profile.id;
  let isStaff = false;
  if (!isHost) {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
      );
    isStaff = !!staff;
  }
  if (!isHost && !isStaff) {
    throw new Error("Only the host or staff can edit this table");
  }

  // 3. Susun perubahan.
  const updates: Partial<{
    title: string | null;
    visibility: "public" | "friends" | "invite_only";
    vibeTags: string[];
  }> = {};
  if (data.title !== undefined) updates.title = data.title?.trim() || null;
  if (data.visibility !== undefined) updates.visibility = data.visibility;
  if (data.vibeTags !== undefined) updates.vibeTags = data.vibeTags;

  if (Object.keys(updates).length === 0) return { ok: true };

  await db
    .update(tableSessions)
    .set(updates)
    .where(eq(tableSessions.id, data.sessionId));

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
  revalidatePath("/bar/[slug]", "page");
  return { ok: true };
}

export async function joinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // 1. Session + table capacity (single join)
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.status !== "open") throw new Error("Session is no longer open");

  // 2. Capacity check — dilewati kalau meja izinkan over-capacity (setting admin).
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (!row.allow_over_capacity && Number(count) >= row.capacity) {
    throw new Error("Table is full");
  }

  // 3. Upsert member (idempotent via unique constraint session_id+profile_id)
  await db
    .insert(sessionMembers)
    .values({
      sessionId,
      profileId: profile.id,
      role: "member",
      status: "joined",
    })
    .onConflictDoUpdate({
      target: [sessionMembers.sessionId, sessionMembers.profileId],
      set: { status: "joined", leftAt: null },
    });

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  return { ok: true, sessionId };
}

/**
 * Request join: insert member dengan status='pending'. Host harus approve dulu.
 * Berbeda dari joinSession (langsung joined) — request join dipakai dari halaman
 * preview tanpa invite code.
 */
export async function requestJoinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // 1. Session check
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      host_id: tableSessions.hostId,
      visibility: tableSessions.visibility,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.status !== "open") throw new Error("Session is no longer open");
  if (row.host_id === profile.id) {
    throw new Error("You're the host, no need to request");
  }

  // Guard relasi (PRD Friends K3 + K6b). Penolakan yg DIHARAPKAN dikembalikan
  // (bukan throw) — production menyensor pesan thrown Server Action.
  // Blokir: pesan generik yg sama dgn friends-only supaya tak membocorkan
  // status blokir (PRD 7.3 disguised).
  if (await isBlockedEitherWay(profile.id, row.host_id)) {
    return {
      status: "error" as const,
      error: "This table isn't accepting join requests right now.",
    };
  }
  if (
    row.visibility === "friends" &&
    !(await areFriends(profile.id, row.host_id))
  ) {
    return {
      status: "error" as const,
      error: "Only the host's friends can join this table.",
    };
  }

  // 2. Capacity check (joined only) — dilewati kalau meja izinkan over-capacity.
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (!row.allow_over_capacity && Number(count) >= row.capacity) {
    throw new Error("Table is full");
  }

  // 3. Existing membership?
  const [existing] = await db
    .select({ id: sessionMembers.id, status: sessionMembers.status })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  if (existing) {
    if (existing.status === "joined") return { status: "joined" as const };
    if (existing.status === "pending") return { status: "pending" as const };
    if (existing.status === "kicked") {
      throw new Error("You were removed from this table by the host");
    }
    // 'left' → revert ke pending
    await db
      .update(sessionMembers)
      .set({ status: "pending", leftAt: null })
      .where(eq(sessionMembers.id, existing.id));
  } else {
    await db.insert(sessionMembers).values({
      sessionId,
      profileId: profile.id,
      role: "member",
      status: "pending",
    });
  }

  // Notif ke host: ada yang minta gabung (perlu approve). Pakai type 'general'
  // (bukan table_invite) — host approve di halaman session, bukan dari tombol
  // Terima/Tolak di bell. Klik notif → buka session.
  await createNotification({
    profileId: row.host_id,
    type: "general",
    title: `${profile.displayName} wants to join table ${row.table_label}`,
    body: "Open the table to approve or decline the request.",
    link: `/session/${sessionId}`,
  });

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath(`/session/${sessionId}/preview`);
  return { status: "pending" as const };
}

export async function approveJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  // Host check + capacity check (single join)
  const [row] = await db
    .select({
      host_id: tableSessions.hostId,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.host_id !== profile.id) {
    throw new Error("Only the host can approve");
  }

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (!row.allow_over_capacity && Number(count) >= row.capacity) {
    throw new Error("Table is full, request can't be approved");
  }

  // Ambil profileId requester (untuk notif) sebelum update.
  const [member] = await db
    .select({ profileId: sessionMembers.profileId })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  // Set pending → joined
  await db
    .update(sessionMembers)
    .set({ status: "joined", joinedAt: new Date() })
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  // Notif ke requester: permintaan gabung diterima.
  if (member) {
    await createNotification({
      profileId: member.profileId,
      type: "table_joined",
      title: `You have been accepted to table ${row.table_label}`,
      body: "The host approved your request. Welcome aboard!",
      link: `/session/${sessionId}`,
      actorId: profile.id, // host yang menyetujui
    });
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

export async function rejectJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  const [session] = await db
    .select({
      host_id: tableSessions.hostId,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!session) throw new Error("Session not found");
  if (session.host_id !== profile.id) {
    throw new Error("Only the host can reject");
  }

  // Profil requester (untuk notif) sebelum delete.
  const [member] = await db
    .select({ profileId: sessionMembers.profileId })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  // Notif ke requester: permintaan ditolak.
  if (member) {
    await createNotification({
      profileId: member.profileId,
      type: "general",
      title: `Your request to join table ${session.table_label} was declined`,
      body: "The host couldn't accept your request this time.",
      link: null,
    });
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Terima undangan (invite_only): user yg DIUNDANG (member pending dgn
 * invited_by terisi) → jadi joined. Cek kapasitas. Beda dgn approveJoinRequest
 * (itu host yg approve request-join). Di sini USER sendiri yg terima.
 */
export async function acceptInvite(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // Pastikan caller adalah member pending yg DIUNDANG (invited_by not null).
  const [member] = await db
    .select({ id: sessionMembers.id, invitedBy: sessionMembers.invitedBy })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );
  if (!member || member.invitedBy == null) {
    throw new Error("Invite not found or no longer valid");
  }

  // Kapasitas
  const [row] = await db
    .select({ capacity: tables.capacity, host_id: tableSessions.hostId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");

  // Undangan basi dari SEBELUM blokir (PRD K6b): tolak dgn pesan generik yg
  // sama dgn undangan hilang — tak membocorkan status blokir.
  const inviterId = member.invitedBy ?? row.host_id;
  if (await isBlockedEitherWay(profile.id, inviterId)) {
    throw new Error("Invite not found or no longer valid");
  }
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (Number(count) >= row.capacity) {
    throw new Error("Table is full");
  }

  await db
    .update(sessionMembers)
    .set({ status: "joined", joinedAt: new Date() })
    .where(eq(sessionMembers.id, member.id));

  // Arsip: tandai undangan diterima (record /profile/invites).
  await markSessionInviteResponded(sessionId, profile.id, "accepted").catch(
    (e) => console.error("[invite] archive accept:", e)
  );

  // Notif ke pengundang bahwa undangan diterima. Pengundang = invited_by
  // (fallback host kalau null, mestinya selalu terisi untuk invite).
  await createNotification({
    profileId: member.invitedBy ?? row.host_id,
    type: "invite_accepted",
    title: `${profile.displayName} accepted your invite`,
    body: `${profile.displayName} joined the table.`,
    link: `/session/${sessionId}`,
    actorId: profile.id,
  });

  // Tandai notif undangan milik penerima sudah direspon → tombol Terima/Tolak
  // di bell hilang, diganti label "Kamu menerima undangan ini".
  await markInviteResponded(`/session/${sessionId}`, "accepted");

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/** Tolak undangan: hapus member pending yg diundang + beri tahu pengundang. */
export async function declineInvite(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // Baca pengundang + label meja SEBELUM delete (row member hilang setelahnya).
  const [info] = await db
    .select({
      invitedBy: sessionMembers.invitedBy,
      hostId: tableSessions.hostId,
      tableLabel: tables.label,
    })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );

  // Arsip: tandai undangan ditolak (record /profile/invites). Row session_members
  // di-hard-delete (perilaku lama tak diubah), tapi arsip menyimpan record-nya.
  await markSessionInviteResponded(sessionId, profile.id, "declined").catch(
    (e) => console.error("[invite] archive decline:", e)
  );

  // Notif ke pengundang bahwa undangan ditolak (counterpart invite_accepted).
  if (info) {
    await createNotification({
      profileId: info.invitedBy ?? info.hostId,
      type: "invite_rejected",
      title: `${profile.displayName} declined your invite`,
      body: `${profile.displayName} did not join table ${info.tableLabel}.`,
      link: `/session/${sessionId}`,
      actorId: profile.id,
    });
  }

  // Tandai notif undangan milik penolak sudah direspon → tombol aksi hilang,
  // diganti label "Kamu menolak undangan ini".
  await markInviteResponded(`/session/${sessionId}`, "rejected");

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

const inviteToSessionSchema = z.object({
  sessionId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1).max(20),
});

/**
 * Host mengundang user ke session yang SUDAH berjalan (dari tab Meja).
 * SELALU pending + invited_by — yg diundang yg menyetujui (acceptInvite);
 * tak ada auto-join (keputusan produk 2026-07-14). Meja "friends" hanya boleh
 * mengundang teman (sejalan K3). Host-only.
 */
export async function inviteUsersToSession(
  input: z.infer<typeof inviteToSessionSchema>
) {
  const profile = await requireProfile();
  const { sessionId, userIds } = inviteToSessionSchema.parse(input);

  // 1. Session + guard host + status open.
  const [row] = await db
    .select({
      status: tableSessions.status,
      host_id: tableSessions.hostId,
      visibility: tableSessions.visibility,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
      max_guests: tableSessions.maxGuests,
      table_label: tables.label,
      bar_name: bars.name,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.host_id !== profile.id) {
    throw new Error("Only the host can invite");
  }
  // Invite boleh saat meja OPEN (lagi dipakai) atau RESERVED (booking untuk
  // nanti — host boleh undang teman lebih dulu). Status lain (closed/cancelled/
  // overdue) tak bisa diundang.
  if (row.status !== "open" && row.status !== "reserved") {
    throw new Error(
      "This table isn't open for invites yet. It needs to be reserved or active."
    );
  }

  // 2. Resolusi user: dedup, buang host, non-staff, non-guest. + email.
  const uniqueIds = Array.from(new Set(userIds)).filter(
    (id) => id !== profile.id
  );
  if (uniqueIds.length === 0) throw new Error("No users selected");
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);
  const candidates = await db
    .select({
      id: profiles.id,
      name: profiles.displayName,
      email: users.email,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.id))
    .where(
      and(
        inArray(profiles.id, uniqueIds),
        eq(profiles.isGuest, false),
        sql`${profiles.id} NOT IN (${staffIds})`
      )
    );
  if (candidates.length === 0) throw new Error("Invalid user");

  // 3. Buang yang sudah jadi member (joined / undangan pending), lalu cek
  //    kapasitas. Slot terpakai = joined + undangan yg belum dijawab — undangan
  //    pending sudah "memesan" kursi, jadi tidak boleh over-invite.
  const existing = await db
    .select({
      profileId: sessionMembers.profileId,
      status: sessionMembers.status,
      invitedBy: sessionMembers.invitedBy,
    })
    .from(sessionMembers)
    .where(eq(sessionMembers.sessionId, sessionId));
  const joinedCount = existing.filter((m) => m.status === "joined").length;
  const pendingInviteCount = existing.filter(
    (m) => m.status === "pending" && m.invitedBy != null
  ).length;
  // Sudah aktif/menunggu = jangan dipilih ulang (joined atau pending-invite).
  const occupied = new Set(
    existing
      .filter(
        (m) =>
          m.status === "joined" ||
          (m.status === "pending" && m.invitedBy != null)
      )
      .map((m) => m.profileId)
  );
  let targets = candidates.filter((c) => !occupied.has(c.id));
  if (targets.length === 0) {
    throw new Error("All users are already at the table / invited");
  }
  // Guard relasi (PRD Friends K2 + K6b) — sama dgn openTable: blokir dibuang
  // senyap; meja "friends" hanya boleh mengundang teman.
  const hiddenIds = await getBlockedIdSet(profile.id);
  targets = targets.filter((u) => !hiddenIds.has(u.id));
  if (row.visibility === "friends" && targets.length > 0) {
    const friendIds = await getFriendIdSet(profile.id);
    targets = targets.filter((u) => friendIds.has(u.id));
  }
  // Kunci LEVEL (PRD Membership M6) — sama dgn openTable: level <= host
  // atau teman; sisanya dibuang senyap.
  if (targets.length > 0) {
    const [hostRank, rankMap, friendIds2] = await Promise.all([
      getEffectiveRankOf(profile.id),
      getEffectiveRankMap(targets.map((u) => u.id)),
      getFriendIdSet(profile.id),
    ]);
    targets = targets.filter(
      (u) =>
        friendIds2.has(u.id) ||
        (rankMap.get(u.id) ?? MEMBERSHIP_RANK.basic) <= hostRank
    );
  }
  if (targets.length === 0) throw new Error("No eligible users to invite");
  // Cek kapasitas untuk KEDUA mode: joined + pending-invite + yg baru.
  // Dilewati kalau meja izinkan over-capacity (setting admin).
  const cap = row.max_guests ?? row.capacity;
  if (
    !row.allow_over_capacity &&
    joinedCount + pendingInviteCount + targets.length > cap
  ) {
    throw new Error(
      `Exceeds table capacity (${cap}). Seats & invites are already filled.`
    );
  }

  // 4. Upsert member (handle yg pernah left/kicked/pending via conflict).
  //    SELALU pending + invited_by — yg diundang yg menyetujui.
  for (const u of targets) {
    await db
      .insert(sessionMembers)
      .values({
        sessionId,
        profileId: u.id,
        role: "member",
        status: "pending",
        invitedBy: profile.id,
      })
      .onConflictDoUpdate({
        target: [sessionMembers.sessionId, sessionMembers.profileId],
        set: {
          status: "pending",
          invitedBy: profile.id,
          leftAt: null,
        },
      });
  }

  // 4b. Arsip undangan (record /profile/invites) — undangan meja aktif dikirim
  //     langsung, jadi dicatat di sini.
  await recordSessionInvites(
    sessionId,
    targets.map((u) => ({ inviterId: profile.id, inviteeId: u.id }))
  ).catch((e) => console.error("[invite] archive active:", e));

  // 5. Notif in-app + email (best-effort).
  const link = `/session/${sessionId}`;
  const tableLabel = row.table_label ?? "table";
  await Promise.allSettled(
    targets.map(async (u) => {
      await createNotification({
        profileId: u.id,
        type: "table_invite",
        title: `${profile.displayName} invited you to table ${tableLabel}`,
        body: `Open to accept the invite to table ${tableLabel}.`,
        link,
        actorId: profile.id,
      });
      const tpl = tableInviteEmail({
        email: u.email,
        inviterName: profile.displayName,
        tableLabel,
        barName: row.bar_name ?? "SOHO",
        link,
        mode: "invited",
      });
      await sendEmail({
        to: u.email,
        subject: `Invite to table ${tableLabel}`,
        kind: "table_invite",
        html: tpl.html,
        text: tpl.text,
      });
    })
  );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  return { invited: targets.length };
}

/**
 * Host membatalkan undangan yang BELUM dijawab (member pending dgn invited_by
 * terisi). Hapus member-nya. Host-only. Beda dgn declineInvite (user sendiri
 * yg menolak) & rejectJoinRequest (host tolak request-join).
 */
export async function cancelInvite(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  // Host check + ambil profil yg diundang + label meja (untuk notif) sebelum
  // delete.
  const [info] = await db
    .select({
      hostId: tableSessions.hostId,
      memberProfileId: sessionMembers.profileId,
      memberStatus: sessionMembers.status,
      invitedBy: sessionMembers.invitedBy,
      tableLabel: tables.label,
    })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId)
      )
    );
  if (!info) throw new Error("Invite not found");
  if (info.hostId !== profile.id) {
    throw new Error("Only the host can cancel an invite");
  }
  if (info.memberStatus !== "pending" || info.invitedBy == null) {
    throw new Error("Only unanswered invites can be cancelled");
  }

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending"),
        sql`${sessionMembers.invitedBy} IS NOT NULL`
      )
    );

  // Arsip: tandai undangan dibatalkan host (record /profile/invites).
  await markSessionInviteResponded(
    sessionId,
    info.memberProfileId,
    "cancelled"
  ).catch((e) => console.error("[invite] archive cancel:", e));

  // Beri tahu user yg dibatalkan: notif undangan lamanya jadi "dibatalkan"
  // (tombol Terima/Tolak hilang) + unread lagi.
  await markInviteCancelled(
    info.memberProfileId,
    `/session/${sessionId}`,
    info.tableLabel ?? "table"
  );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/** Satu baris undangan meja yang diterima user (untuk /profile/invites). */
export interface MyInviteItem {
  session_id: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  invited_at: string;
  responded_at: string | null;
  inviter_name: string;
  inviter_avatar: string | null;
  table_label: string;
  area_name: string;
  session_status: string;
  reservation_at: string | null;
  /** true kalau baris session_members pending-nya masih ada (bisa di-accept). */
  can_respond: boolean;
}

/**
 * Undangan meja yang DITERIMA user (invitee = dia) dari arsip session_invites —
 * untuk halaman /profile/invites. Terbaru dulu. `can_respond` true hanya kalau
 * status masih 'pending' DAN baris session_members pending-nya masih ada
 * (undangan bisa jadi sudah expired/booking batal → arsip pending tapi member
 * hilang → tak bisa di-accept lagi).
 */
export async function getMyInvites(): Promise<MyInviteItem[]> {
  const profile = await requireProfile();
  const inviter = aliasedTable(profiles, "inviter_profile");

  const rows = await db
    .select({
      session_id: sessionInvites.sessionId,
      status: sessionInvites.status,
      invited_at: sessionInvites.invitedAt,
      responded_at: sessionInvites.respondedAt,
      inviter_name: inviter.displayName,
      inviter_avatar: inviter.avatarUrl,
      table_label: tables.label,
      area_name: floorAreas.name,
      session_status: tableSessions.status,
      reservation_at: tableSessions.reservationAt,
      member_status: sessionMembers.status,
    })
    .from(sessionInvites)
    .innerJoin(inviter, eq(inviter.id, sessionInvites.inviterId))
    .innerJoin(tableSessions, eq(tableSessions.id, sessionInvites.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    // LEFT: baris member pending bisa saja sudah hilang (declined/expired).
    .leftJoin(
      sessionMembers,
      and(
        eq(sessionMembers.sessionId, sessionInvites.sessionId),
        eq(sessionMembers.profileId, sessionInvites.inviteeId),
        eq(sessionMembers.status, "pending")
      )
    )
    .where(eq(sessionInvites.inviteeId, profile.id))
    .orderBy(desc(sessionInvites.invitedAt));

  return rows.map((r) => ({
    session_id: r.session_id,
    status: r.status,
    invited_at: r.invited_at.toISOString(),
    responded_at: r.responded_at ? r.responded_at.toISOString() : null,
    inviter_name: r.inviter_name,
    inviter_avatar: r.inviter_avatar,
    table_label: r.table_label,
    area_name: r.area_name,
    session_status: r.session_status,
    reservation_at: r.reservation_at ? r.reservation_at.toISOString() : null,
    // Bisa direspon hanya kalau arsip masih pending & member pending-nya ada.
    can_respond: r.status === "pending" && r.member_status === "pending",
  }));
}

/**
 * Jumlah undangan meja yang masih MENUNGGU keputusan user (untuk lencana menu).
 * Actionable = arsip pending DAN baris member pending-nya masih ada.
 */
export async function getMyPendingInviteCount(): Promise<number> {
  const profile = await requireProfile();
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionInvites)
    .innerJoin(
      sessionMembers,
      and(
        eq(sessionMembers.sessionId, sessionInvites.sessionId),
        eq(sessionMembers.profileId, sessionInvites.inviteeId),
        eq(sessionMembers.status, "pending")
      )
    )
    .where(
      and(
        eq(sessionInvites.inviteeId, profile.id),
        eq(sessionInvites.status, "pending")
      )
    );
  return Number(row?.count ?? 0);
}

/**
 * Anggota keluar dari meja.
 *
 * GUARD: tak boleh keluar selama MEJA masih punya sisa tagihan (siapa pun yang
 * belum bayar) — cegah orang kabur dari tanggungan bersama. Order 'unpaid'
 * (belum dibayar sama sekali) juga menahan, sama seperti guard di closeSession.
 */
export async function leaveSession(sessionId: string) {
  const profile = await requireProfile();

  // Meja sudah selesai (closed/overdue/cancelled) → tak ada lagi "keluar meja";
  // riwayat keanggotaan dibekukan apa adanya.
  const [sess] = await db
    .select({
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableLabel: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!sess) throw new Error("Table not found");
  if (
    sess.status === "closed" ||
    sess.status === "overdue" ||
    sess.status === "cancelled"
  ) {
    throw new Error("This table has already ended. You can't leave it now.");
  }

  // Sisa tagihan meja (subtotal+charge semua order − pembayaran lunas).
  const outstanding =
    (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
  // Order yang belum dibayar sama sekali (item sudah masuk tapi belum ditagih).
  const [unpaidOrder] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, sessionId), eq(orders.status, "unpaid")));

  if (outstanding > 0 || unpaidOrder) {
    throw new Error(
      "You can't leave while the table still has an unpaid bill. Please settle it first."
    );
  }

  await db
    .update(sessionMembers)
    .set({ status: "left", leftAt: new Date() })
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  // Kabari host + anggota lain yang masih di meja (bukan yang keluar).
  const others = await db
    .select({ profileId: sessionMembers.profileId })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "joined"),
        ne(sessionMembers.profileId, profile.id)
      )
    );
  const recipients = new Set(others.map((o) => o.profileId));
  recipients.add(sess.hostId); // host tetap dikabari walau (mis.) sudah keluar
  recipients.delete(profile.id); // jangan kabari diri sendiri
  await Promise.allSettled(
    Array.from(recipients).map((profileId) =>
      createNotification({
        profileId,
        type: "general",
        title: `${profile.displayName} left table ${sess.tableLabel}`,
        body: "They are no longer at the table.",
        link: `/session/${sessionId}`,
      })
    )
  );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Tutup meja. Boleh dipanggil oleh:
 * - Host meja (customer yang buka meja sendiri)
 * - Staff dengan permission `close_session` (waiter/cashier/manager/admin)
 *
 * Guardrail untuk WAITER: harus lunas. Tujuan: cegah waiter close meja yang
 * belum bayar (resiko kerugian). Cashier/manager/admin tetap bisa close kapan
 * saja (untuk edge case refund / void). Customer host tetap bisa close kapan
 * saja (mereka punya bill sendiri).
 */
export async function closeSession(sessionId: string) {
  const profile = await requireProfile();

  const [session] = await db
    .select({ host_id: tableSessions.hostId })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!session) throw new Error("Session not found");

  const isHost = session.host_id === profile.id;

  // Kalau bukan host, cek apakah dia staff dengan permission close_session
  let staffRoleName: string | null = null;
  if (!isHost) {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
      );
    if (!staff) {
      throw new Error("Only the host or staff can close the table");
    }
    staffRoleName = staff.role;
  }

  // Close guard host/customer (Q6): host TIDAK boleh menutup meja bila masih ada
  // order belum lunas (unpaid) atau sisa tagihan. Staff kasir tetap boleh
  // force-close (meng-void order unpaid). Waiter punya guardrail sendiri di bawah.
  if (isHost) {
    const [unpaidOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.sessionId, sessionId), eq(orders.status, "unpaid")));
    const outstanding =
      (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
    if (unpaidOrder || outstanding > 0) {
      throw new Error(
        "Settle all payments before closing the table."
      );
    }
  }

  // Guardrail waiter: hanya boleh close kalau meja lunas
  if (staffRoleName === "waiter") {
    const [billRow] = await db
      .select({
        subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
      })
      .from(orders)
      .leftJoin(
        orderItems,
        and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
      )
      .where(eq(orders.sessionId, sessionId));

    const [paidRow] = await db
      .select({
        paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        and(eq(orders.sessionId, sessionId), eq(payments.status, "paid"))
      );

    const subtotal = Number(billRow?.subtotal ?? 0);
    const paid = Number(paidRow?.paid ?? 0);
    const outstanding = Math.max(0, subtotal - paid);

    if (outstanding > 0) {
      throw new Error(
        `Not fully paid. Rp ${outstanding.toLocaleString("id-ID")} remaining. Direct the guest to the cashier.`
      );
    }
  }

  // Q6: order 'unpaid' menggantung saat close (staff force-close) → VOID item-nya
  // supaya tak ditagih (order belum "masuk"). Item void tak dihitung outstanding.
  const unpaidOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, sessionId), eq(orders.status, "unpaid")));
  if (unpaidOrders.length > 0) {
    const ids = unpaidOrders.map((o) => o.id);
    await db
      .update(orderItems)
      .set({ status: "void" })
      .where(inArray(orderItems.orderId, ids));
    // Matikan juga QRIS/pay-at-cashier yang masih pending di order itu.
    // Tanpa ini: item sudah di-void & order ditutup, tapi QRIS anggota masih
    // hidup di sisi gateway. Kalau dia terlanjur bayar, uangnya masuk ke order
    // tertutup tanpa item — pelanggan membayar dan tak menerima apa pun.
    // (cancelUnpaidOrder sudah melakukan ini; force-close melewatkannya.)
    await db
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(
        and(inArray(payments.orderId, ids), eq(payments.status, "pending"))
      );
  }

  // Tentukan outstanding saat tutup. Kalau masih nunggak → status 'overdue'
  // (tagihan tetap tertagih via banner home), JANGAN 'closed' & JANGAN arahkan
  // host ke /rate — itu bikin pingpong /session ⇄ /rate (RatePage tolak krn
  // outstanding>0). Lunas → 'closed' + rating.
  const outstanding = (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
  const lunas = outstanding <= 0;

  const now = new Date();
  await Promise.all([
    db
      .update(tableSessions)
      .set({ status: lunas ? "closed" : "overdue", closedAt: now })
      .where(eq(tableSessions.id, sessionId)),
    db
      .update(orders)
      .set({ status: "closed", closedAt: now })
      .where(eq(orders.sessionId, sessionId)),
  ]);

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");

  // Customer host: lunas → /rate; belum lunas → tetap di /session (bisa lunasi).
  // Staff → dashboard role-nya supaya bisa lanjut handle meja lain.
  if (isHost) {
    redirect(lunas ? `/session/${sessionId}/rate` : `/session/${sessionId}`);
  }
  if (staffRoleName === "waiter") redirect("/staff/waiter?tab=sessions");
  if (staffRoleName === "cashier") redirect("/staff/cashier");
  redirect("/admin");
}

export async function leaveSessionAndRate(sessionId: string) {
  await leaveSession(sessionId);
  redirect("/");
}
