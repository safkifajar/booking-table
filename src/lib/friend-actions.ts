"use server";

/**
 * Server Actions — Friends & Block (PRD Friends, Fase 1).
 *
 * Aturan inti yang DITEGAKKAN DI SINI (bukan di UI):
 * - Mutasi relasi antar dua user diserialisasi dgn advisory lock per-pasangan
 *   (race mutual-request / accept-vs-cancel / block-vs-request — PRD 10.2).
 * - Transisi status request selalu CONDITIONAL UPDATE (WHERE status='pending')
 *   + cek baris terpengaruh — nol baris = "Request is no longer available".
 * - Blokir = SENYAP (PRD 7.3): yang diblokir mendapat sukses palsu, tak pernah
 *   error/push yang membocorkan. Notifikasi TIDAK dikirim dari dalam
 *   transaksi (PRD 10.2) — dikirim setelah commit.
 * - Anti-spam (PRD 6.4): cooldown 1 hari setelah ditolak + kuota 20/24 jam +
 *   tanpa push untuk kiriman ulang <24 jam ke orang yang sama.
 *
 * Satu-satunya file selain src/lib/friends.ts yang boleh menyentuh tabel
 * friendships / friend_requests / user_blocks.
 */

import { revalidatePath } from "next/cache";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  friendRequests,
  friendships,
  userBlocks,
} from "@/lib/db/schema/friends";
import { profiles } from "@/lib/db/schema/profiles";
import { requireProfile } from "@/lib/auth-v2/current";
import {
  createNotification,
  markNotificationRespondedByRef,
  deleteNotificationsByRef,
} from "@/lib/notifications";
import {
  orderPair,
  lockPair,
  assertFriendableTarget,
  getRelationship,
  countOutgoingLast24h,
  RESEND_COOLDOWN_HOURS,
  DAILY_OUTGOING_QUOTA,
  type RelationshipStatus,
} from "@/lib/friends";

const idSchema = z.string().uuid();

/** Revalidasi halaman yang menampilkan relasi. */
function revalidateFriendSurfaces(otherId?: string) {
  revalidatePath("/network");
  revalidatePath("/profile/friends");
  if (otherId) revalidatePath(`/network/${otherId}`);
}

// ============================================================
// SEND REQUEST
// ============================================================

export interface SendFriendRequestResult {
  /** Status relasi SETELAH aksi (yang boleh dirender UI). */
  status: Extract<RelationshipStatus, "pending_out" | "friends">;
}

export async function sendFriendRequest(input: {
  targetId: string;
}): Promise<SendFriendRequestResult> {
  const me = await requireProfile();
  const targetId = idSchema.parse(input.targetId).toLowerCase();

  if (targetId === me.id.toLowerCase()) {
    throw new Error("You can't send a friend request to yourself");
  }
  await assertFriendableTarget(targetId);

  // Hasil untuk notifikasi PASCA-commit (jangan kirim di dalam tx — PRD 10.2).
  let notifyNewRequest: { requestId: string; skipPush: boolean } | null = null;
  let notifyAccepted: { theirRequestId: string } | null = null;

  const result = await db.transaction(async (tx): Promise<SendFriendRequestResult> => {
    await lockPair(tx, me.id, targetId);

    // 1. Blokir (arah mana pun) → SUKSES PALSU (PRD 7.3). Tak menyimpan apa
    //    pun, tak memberi tahu siapa pun. UI menampilkan "Requested".
    const [blocked] = await tx
      .select({ x: userBlocks.blockerId })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, me.id), eq(userBlocks.blockedId, targetId)),
          and(eq(userBlocks.blockerId, targetId), eq(userBlocks.blockedId, me.id))
        )
      )
      .limit(1);
    if (blocked) return { status: "pending_out" };

    // 2. Sudah berteman → no-op.
    const [lo, hi] = orderPair(me.id, targetId);
    const [existingFriendship] = await tx
      .select({ a: friendships.userAId })
      .from(friendships)
      .where(and(eq(friendships.userAId, lo), eq(friendships.userBId, hi)))
      .limit(1);
    if (existingFriendship) return { status: "friends" };

    // 3. Dia sudah kirim request ke aku → LANGSUNG jadi teman (PRD 6.1).
    const [incoming] = await tx
      .select({ id: friendRequests.id })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.requesterId, targetId),
          eq(friendRequests.addresseeId, me.id),
          eq(friendRequests.status, "pending")
        )
      )
      .limit(1);
    if (incoming) {
      await tx
        .insert(friendships)
        .values({ userAId: lo, userBId: hi })
        .onConflictDoNothing();
      // Tutup SEMUA request antara pasangan ini, dua arah (PRD 10.2).
      await tx
        .update(friendRequests)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(
          and(
            or(
              and(
                eq(friendRequests.requesterId, targetId),
                eq(friendRequests.addresseeId, me.id)
              ),
              and(
                eq(friendRequests.requesterId, me.id),
                eq(friendRequests.addresseeId, targetId)
              )
            ),
            eq(friendRequests.status, "pending")
          )
        );
      notifyAccepted = { theirRequestId: incoming.id };
      return { status: "friends" };
    }

    // 4. Kuota harian (PRD 6.4).
    const sent = await countOutgoingLast24h(me.id);
    if (sent >= DAILY_OUTGOING_QUOTA) {
      throw new Error(
        "You've reached the daily friend request limit. Try again tomorrow."
      );
    }

    // 5. Baris keluar yang sudah ada → DIPAKAI ULANG (PRD 6.3; unique per arah
    //    membuat INSERT kedua selalu gagal).
    const [mine] = await tx
      .select({
        id: friendRequests.id,
        status: friendRequests.status,
        createdAt: friendRequests.createdAt,
        respondedAt: friendRequests.respondedAt,
      })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.requesterId, me.id),
          eq(friendRequests.addresseeId, targetId)
        )
      )
      .limit(1);

    if (mine) {
      if (mine.status === "pending") return { status: "pending_out" }; // idempoten

      // Cooldown 1 hari setelah DITOLAK. Pesan sengaja generik — jangan
      // membocorkan bahwa dia menolak (PRD 6.2: penolakan tak diberi tahu).
      if (mine.status === "rejected" && mine.respondedAt) {
        const readyAt =
          mine.respondedAt.getTime() + RESEND_COOLDOWN_HOURS * 60 * 60 * 1000;
        if (Date.now() < readyAt) {
          throw new Error(
            "You've sent a request to this user recently. Please try again later."
          );
        }
      }

      // Kiriman ulang <24 jam ke orang yang sama → tanpa push (PRD 6.4).
      const skipPush =
        Date.now() - mine.createdAt.getTime() < 24 * 60 * 60 * 1000;
      await tx
        .update(friendRequests)
        .set({ status: "pending", createdAt: new Date(), respondedAt: null })
        .where(eq(friendRequests.id, mine.id));
      notifyNewRequest = { requestId: mine.id, skipPush };
      return { status: "pending_out" };
    }

    // 6. Request baru.
    const [created] = await tx
      .insert(friendRequests)
      .values({ requesterId: me.id, addresseeId: targetId })
      .returning({ id: friendRequests.id });
    notifyNewRequest = { requestId: created.id, skipPush: false };
    return { status: "pending_out" };
  });

  // Notifikasi PASCA-commit.
  if (notifyNewRequest) {
    const n = notifyNewRequest as { requestId: string; skipPush: boolean };
    await createNotification({
      profileId: targetId,
      type: "friend_request",
      title: `${me.displayName} sent you a friend request`,
      body: "Tap to view their profile.",
      link: `/network/${me.id}`,
      refId: n.requestId,
      skipPush: n.skipPush,
    });
  }
  if (notifyAccepted) {
    const n = notifyAccepted as { theirRequestId: string };
    // Mutual: aku "menerima" request dia → kabari DIA, dan matikan tombol di
    // notif request miliknya yang ada di bell-ku.
    await createNotification({
      profileId: targetId,
      type: "friend_accepted",
      title: `${me.displayName} accepted your friend request`,
      link: `/network/${me.id}`,
      refId: n.theirRequestId,
    });
    await markNotificationRespondedByRef(me.id, n.theirRequestId);
  }

  revalidateFriendSurfaces(targetId);
  return result;
}

// ============================================================
// ACCEPT / DECLINE / CANCEL
// ============================================================

export async function acceptFriendRequest(input: {
  requestId: string;
}): Promise<void> {
  const me = await requireProfile();
  const requestId = idSchema.parse(input.requestId);

  let requesterId: string | null = null;

  await db.transaction(async (tx) => {
    // Baca dulu utk tahu pasangannya, lock, lalu RE-CHECK via conditional
    // update (state bisa berubah antara baca dan lock — PRD 10.2).
    const [req] = await tx
      .select({
        requesterId: friendRequests.requesterId,
        addresseeId: friendRequests.addresseeId,
      })
      .from(friendRequests)
      .where(eq(friendRequests.id, requestId))
      .limit(1);
    if (!req || req.addresseeId !== me.id) {
      throw new Error("Request is no longer available");
    }
    await lockPair(tx, req.requesterId, req.addresseeId);

    const updated = await tx
      .update(friendRequests)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(
        and(
          eq(friendRequests.id, requestId),
          eq(friendRequests.addresseeId, me.id),
          eq(friendRequests.status, "pending")
        )
      )
      .returning({ id: friendRequests.id });
    if (updated.length === 0) {
      throw new Error("Request is no longer available");
    }

    const [lo, hi] = orderPair(req.requesterId, me.id);
    await tx
      .insert(friendships)
      .values({ userAId: lo, userBId: hi })
      .onConflictDoNothing();

    // Tutup request arah sebaliknya (kalau ada) — cegah baris silang nyangkut.
    await tx
      .update(friendRequests)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(
        and(
          eq(friendRequests.requesterId, me.id),
          eq(friendRequests.addresseeId, req.requesterId),
          eq(friendRequests.status, "pending")
        )
      );

    requesterId = req.requesterId;
  });

  if (requesterId) {
    await createNotification({
      profileId: requesterId,
      type: "friend_accepted",
      title: `${me.displayName} accepted your friend request`,
      link: `/network/${me.id}`,
      refId: requestId,
    });
    // Tombol Accept/Decline di bell-ku hilang.
    await markNotificationRespondedByRef(me.id, requestId);
    revalidateFriendSurfaces(requesterId);
  }
}

export async function declineFriendRequest(input: {
  requestId: string;
}): Promise<void> {
  const me = await requireProfile();
  const requestId = idSchema.parse(input.requestId);

  const updated = await db
    .update(friendRequests)
    .set({ status: "rejected", respondedAt: new Date() })
    .where(
      and(
        eq(friendRequests.id, requestId),
        eq(friendRequests.addresseeId, me.id),
        eq(friendRequests.status, "pending")
      )
    )
    .returning({ id: friendRequests.id });
  if (updated.length === 0) {
    throw new Error("Request is no longer available");
  }

  // Pengirim TIDAK diberi tahu (PRD 6.2). Hanya matikan tombol di bell-ku.
  await markNotificationRespondedByRef(me.id, requestId);
  revalidateFriendSurfaces();
}

export async function cancelFriendRequest(input: {
  requestId: string;
}): Promise<void> {
  const me = await requireProfile();
  const requestId = idSchema.parse(input.requestId);

  const updated = await db
    .update(friendRequests)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(friendRequests.id, requestId),
        eq(friendRequests.requesterId, me.id),
        eq(friendRequests.status, "pending")
      )
    )
    .returning({ addresseeId: friendRequests.addresseeId });
  if (updated.length === 0) {
    throw new Error("Request is no longer available");
  }

  // Cabut notif request dari bell penerima (senyap, tanpa push).
  await deleteNotificationsByRef(requestId);
  revalidateFriendSurfaces(updated[0].addresseeId);
}

// ============================================================
// UNFRIEND
// ============================================================

export async function unfriend(input: { userId: string }): Promise<void> {
  const me = await requireProfile();
  const otherId = idSchema.parse(input.userId).toLowerCase();

  await db.transaction(async (tx) => {
    await lockPair(tx, me.id, otherId);
    const [lo, hi] = orderPair(me.id, otherId);
    // Idempoten: bukan teman → no-op sukses (PRD 10.3).
    await tx
      .delete(friendships)
      .where(and(eq(friendships.userAId, lo), eq(friendships.userBId, hi)));
  });

  // Tanpa notifikasi (PRD 6.1). Refresh halaman profil supaya data privat
  // yang tadinya terbuka utk teman tak tersaji dari cache (PRD 8/D2).
  revalidateFriendSurfaces(otherId);
}

// ============================================================
// BLOCK / UNBLOCK
// ============================================================

export async function blockUser(input: { userId: string }): Promise<void> {
  const me = await requireProfile();
  const targetId = idSchema.parse(input.userId).toLowerCase();
  if (targetId === me.id.toLowerCase()) {
    throw new Error("You can't block yourself");
  }
  const [target] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, targetId));
  if (!target) throw new Error("User not found");

  let cancelledRequestIds: string[] = [];

  await db.transaction(async (tx) => {
    await lockPair(tx, me.id, targetId);

    // Idempoten — tapi efek samping TETAP dijalankan (kalau blokir sebelumnya
    // gagal separuh jalan, PRD 10.3).
    await tx
      .insert(userBlocks)
      .values({ blockerId: me.id, blockedId: targetId })
      .onConflictDoNothing();

    // Putus pertemanan.
    const [lo, hi] = orderPair(me.id, targetId);
    await tx
      .delete(friendships)
      .where(and(eq(friendships.userAId, lo), eq(friendships.userBId, hi)));

    // Batalkan request pending KEDUA ARAH.
    const cancelled = await tx
      .update(friendRequests)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(
        and(
          or(
            and(
              eq(friendRequests.requesterId, me.id),
              eq(friendRequests.addresseeId, targetId)
            ),
            and(
              eq(friendRequests.requesterId, targetId),
              eq(friendRequests.addresseeId, me.id)
            )
          ),
          eq(friendRequests.status, "pending")
        )
      )
      .returning({ id: friendRequests.id });
    cancelledRequestIds = cancelled.map((c) => c.id);
  });

  // Cabut notif request terkait dari KEDUA bell — senyap, TANPA push apa pun
  // ke yang diblokir (sekali push "dibatalkan" terkirim, blokirnya bocor —
  // PRD 7.3 / G2).
  for (const rid of cancelledRequestIds) {
    await deleteNotificationsByRef(rid);
  }

  revalidateFriendSurfaces(targetId);
  revalidatePath("/profile/blocked");
}

export async function unblockUser(input: { userId: string }): Promise<void> {
  const me = await requireProfile();
  const targetId = idSchema.parse(input.userId).toLowerCase();

  // HANYA baris milikku. Blokir milik dia (kalau ada) tetap berlaku (PRD 4.3).
  await db
    .delete(userBlocks)
    .where(
      and(eq(userBlocks.blockerId, me.id), eq(userBlocks.blockedId, targetId))
    );

  revalidateFriendSurfaces(targetId);
  revalidatePath("/profile/blocked");
}

// ============================================================
// READ — untuk UI (Fase 2)
// ============================================================

export interface FriendListEntry {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  /** Kapan berteman (friendships) / request dibuat (requests). */
  since: string;
}

export async function getMyFriendsList(): Promise<FriendListEntry[]> {
  const me = await requireProfile();
  const rows = await db
    .select({
      a: friendships.userAId,
      b: friendships.userBId,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .where(
      or(eq(friendships.userAId, me.id), eq(friendships.userBId, me.id))
    )
    .orderBy(desc(friendships.createdAt));
  const otherIds = rows.map((r) => (r.a === me.id ? r.b : r.a));
  if (otherIds.length === 0) return [];

  const people = await db
    .select({
      id: profiles.id,
      display_name: profiles.displayName,
      username: profiles.username,
      avatar_url: profiles.avatarUrl,
    })
    .from(profiles)
    .where(or(...otherIds.map((id) => eq(profiles.id, id))));
  const byId = new Map(people.map((p) => [p.id, p]));

  return rows.flatMap((r) => {
    const otherId = r.a === me.id ? r.b : r.a;
    const p = byId.get(otherId);
    if (!p) return [];
    return [
      {
        id: p.id,
        display_name: p.display_name,
        username: p.username,
        avatar_url: p.avatar_url,
        since: r.createdAt.toISOString(),
      },
    ];
  });
}

export interface FriendRequestEntry extends FriendListEntry {
  request_id: string;
}

export async function getIncomingRequests(): Promise<FriendRequestEntry[]> {
  const me = await requireProfile();
  const rows = await db
    .select({
      request_id: friendRequests.id,
      created_at: friendRequests.createdAt,
      id: profiles.id,
      display_name: profiles.displayName,
      username: profiles.username,
      avatar_url: profiles.avatarUrl,
      is_active: profiles.isActive,
      is_guest: profiles.isGuest,
    })
    .from(friendRequests)
    .innerJoin(profiles, eq(profiles.id, friendRequests.requesterId))
    .where(
      and(
        eq(friendRequests.addresseeId, me.id),
        eq(friendRequests.status, "pending")
      )
    )
    .orderBy(desc(friendRequests.createdAt));
  // Pengirim nonaktif/guest tak ditampilkan (PRD 10.5 badge rule berlaku juga
  // di daftar).
  return rows
    .filter((r) => r.is_active && !r.is_guest)
    .map((r) => ({
      request_id: r.request_id,
      id: r.id,
      display_name: r.display_name,
      username: r.username,
      avatar_url: r.avatar_url,
      since: r.created_at.toISOString(),
    }));
}

export async function getOutgoingRequests(): Promise<FriendRequestEntry[]> {
  const me = await requireProfile();
  const rows = await db
    .select({
      request_id: friendRequests.id,
      created_at: friendRequests.createdAt,
      id: profiles.id,
      display_name: profiles.displayName,
      username: profiles.username,
      avatar_url: profiles.avatarUrl,
    })
    .from(friendRequests)
    .innerJoin(profiles, eq(profiles.id, friendRequests.addresseeId))
    .where(
      and(
        eq(friendRequests.requesterId, me.id),
        eq(friendRequests.status, "pending")
      )
    )
    .orderBy(desc(friendRequests.createdAt));
  return rows.map((r) => ({
    request_id: r.request_id,
    id: r.id,
    display_name: r.display_name,
    username: r.username,
    avatar_url: r.avatar_url,
    since: r.created_at.toISOString(),
  }));
}

export async function getBlockedList(): Promise<FriendListEntry[]> {
  const me = await requireProfile();
  const rows = await db
    .select({
      created_at: userBlocks.createdAt,
      id: profiles.id,
      display_name: profiles.displayName,
      username: profiles.username,
      avatar_url: profiles.avatarUrl,
    })
    .from(userBlocks)
    .innerJoin(profiles, eq(profiles.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, me.id))
    .orderBy(desc(userBlocks.createdAt));
  return rows.map((r) => ({
    id: r.id,
    display_name: r.display_name,
    username: r.username,
    avatar_url: r.avatar_url,
    since: r.created_at.toISOString(),
  }));
}

/** Badge "friend requests" di Network (PRD j). */
export async function getIncomingRequestCount(): Promise<number> {
  const me = await requireProfile();
  const rows = await db
    .select({ id: friendRequests.id })
    .from(friendRequests)
    .innerJoin(profiles, eq(profiles.id, friendRequests.requesterId))
    .where(
      and(
        eq(friendRequests.addresseeId, me.id),
        eq(friendRequests.status, "pending"),
        eq(profiles.isActive, true),
        eq(profiles.isGuest, false)
      )
    );
  return rows.length;
}

/** Status relasi aku -> user lain (untuk tombol di profil). */
export async function getRelationshipWith(
  userId: string
): Promise<RelationshipStatus> {
  const me = await requireProfile();
  return getRelationship(me.id, idSchema.parse(userId));
}
