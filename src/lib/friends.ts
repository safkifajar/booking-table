import "server-only";

/**
 * Helper terpusat pertemanan & blokir (PRD Friends).
 *
 * ATURAN KERAS: JANGAN menulis query ke tabel friendships / user_blocks di
 * luar file ini. Dua alasan:
 * 1. friendships = SATU baris per pasangan dengan urutan kanonik
 *    user_a < user_b. Query yang lupa mengurutkan akan salah membaca
 *    "bukan teman" padahal berteman (PRD 10.4).
 * 2. Blokir efeknya SIMETRIS tapi disimpan searah — pengecekan yang cuma
 *    satu arah = blokir bocor (PRD 4.3).
 */

import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { friendRequests, friendships, userBlocks } from "@/lib/db/schema/friends";
import { profiles } from "@/lib/db/schema/profiles";
import { staffRoles } from "@/lib/db/schema/extras";

// ============================================================
// PASANGAN KANONIK
// ============================================================

/**
 * Urutkan pasangan id ke bentuk kanonik [lo, hi].
 * Dinormalkan ke lowercase dulu: perbandingan string hex-lowercase di JS
 * ekuivalen dengan perbandingan byte tipe uuid di Postgres — TAPI hanya kalau
 * case-nya konsisten. Semua akses friendships WAJIB lewat sini.
 */
export function orderPair(a: string, b: string): [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

/**
 * Advisory lock per-PASANGAN (transaksi): serialisasi semua mutasi relasi
 * antara dua user (request/accept/block bersamaan — PRD 10.2). Satu lock per
 * pasangan (bukan dua per-user) → urutan deterministik, tak bisa deadlock.
 * Panggil di AWAL db.transaction.
 */
export async function lockPair(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  a: string,
  b: string
): Promise<void> {
  const [lo, hi] = orderPair(a, b);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${lo} || ':' || ${hi}, 0))`
  );
}

// ============================================================
// PERTEMANAN — BACA
// ============================================================

export async function areFriends(a: string, b: string): Promise<boolean> {
  const [lo, hi] = orderPair(a, b);
  const [row] = await db
    .select({ a: friendships.userAId })
    .from(friendships)
    .where(and(eq(friendships.userAId, lo), eq(friendships.userBId, hi)))
    .limit(1);
  return !!row;
}

/** Semua id teman seorang user (cek DUA kolom). */
export async function getFriendIds(userId: string): Promise<string[]> {
  const uid = userId.toLowerCase();
  const rows = await db
    .select({ a: friendships.userAId, b: friendships.userBId })
    .from(friendships)
    .where(or(eq(friendships.userAId, uid), eq(friendships.userBId, uid)));
  return rows.map((r) => (r.a === uid ? r.b : r.a));
}

export async function getFriendIdSet(userId: string): Promise<Set<string>> {
  return new Set(await getFriendIds(userId));
}

/** Jumlah teman satu user. */
export async function getFriendCount(userId: string): Promise<number> {
  const uid = userId.toLowerCase();
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(friendships)
    .where(or(eq(friendships.userAId, uid), eq(friendships.userBId, uid)));
  return Number(row?.n ?? 0);
}

/**
 * Jumlah teman BANYAK user sekaligus (satu query UNION ALL — PRD 10.4:
 * jangan per-baris). Untuk list admin/Network.
 */
export async function getFriendCounts(
  userIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const ids = userIds.map((i) => i.toLowerCase());
  const rows = await db.execute(sql`
    SELECT uid, COUNT(*)::int AS n FROM (
      SELECT user_a_id AS uid FROM friendships WHERE user_a_id = ANY(${ids})
      UNION ALL
      SELECT user_b_id AS uid FROM friendships WHERE user_b_id = ANY(${ids})
    ) t GROUP BY uid
  `);
  for (const r of rows as unknown as { uid: string; n: number }[]) {
    out.set(r.uid, Number(r.n));
  }
  return out;
}

// ============================================================
// BLOKIR — BACA (selalu DUA ARAH)
// ============================================================

/** Ada blokir ke arah MANA PUN antara a dan b? */
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ x: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a))
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Semua id yang saling blokir dengan viewer (kedua arah) — PENYARING TERPUSAT
 * untuk semua query yang menampilkan orang (PRD 7.2). Pakai:
 *   const hidden = await getBlockedIdSet(viewerId);
 *   ...filter row: !hidden.has(row.profileId)
 * atau untuk SQL: notInArray(col, [...hidden]) bila set tidak kosong.
 */
export async function getBlockedIdSet(viewerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ blocker: userBlocks.blockerId, blocked: userBlocks.blockedId })
    .from(userBlocks)
    .where(
      or(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, viewerId))
    );
  const out = new Set<string>();
  for (const r of rows) out.add(r.blocker === viewerId ? r.blocked : r.blocker);
  return out;
}

// ============================================================
// STATUS RELASI (untuk UI)
// ============================================================

/**
 * Status relasi viewer -> orang lain. "blocked_by" SENGAJA tidak ada:
 * kalau dia memblokir viewer, dari sisi viewer dia "tidak ada" (PRD 5, 7.3)
 * — daftar/profil sudah menyaringnya, jadi status ini tak pernah dirender.
 */
export type RelationshipStatus =
  | "none"
  | "pending_out"
  | "pending_in"
  | "friends"
  | "blocked";

/**
 * Status relasi untuk BANYAK orang sekaligus (satu batch query per tabel —
 * PRD 10.4). Untuk kartu Network / daftar.
 */
export async function getRelationshipMap(
  viewerId: string,
  otherIds: string[]
): Promise<Map<string, RelationshipStatus>> {
  const out = new Map<string, RelationshipStatus>();
  if (otherIds.length === 0) return out;
  const ids = otherIds.map((i) => i.toLowerCase());
  const me = viewerId.toLowerCase();
  for (const id of ids) out.set(id, "none");

  // Teman
  const fr = await db
    .select({ a: friendships.userAId, b: friendships.userBId })
    .from(friendships)
    .where(
      or(
        and(eq(friendships.userAId, me), inArray(friendships.userBId, ids)),
        and(eq(friendships.userBId, me), inArray(friendships.userAId, ids))
      )
    );
  for (const r of fr) out.set(r.a === me ? r.b : r.a, "friends");

  // Request pending (dua arah)
  const reqs = await db
    .select({
      requester: friendRequests.requesterId,
      addressee: friendRequests.addresseeId,
    })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "pending"),
        or(
          and(
            eq(friendRequests.requesterId, me),
            inArray(friendRequests.addresseeId, ids)
          ),
          and(
            eq(friendRequests.addresseeId, me),
            inArray(friendRequests.requesterId, ids)
          )
        )
      )
    );
  for (const r of reqs) {
    if (r.requester === me && out.get(r.addressee) !== "friends") {
      out.set(r.addressee, "pending_out");
    } else if (r.addressee === me && out.get(r.requester) !== "friends") {
      out.set(r.requester, "pending_in");
    }
  }

  // Blokir MILIKKU (aku memblokir dia). Yang memblokirku tak diberi status
  // khusus — mereka disaring dari daftar sebelum sampai sini.
  const blocks = await db
    .select({ blocked: userBlocks.blockedId })
    .from(userBlocks)
    .where(
      and(eq(userBlocks.blockerId, me), inArray(userBlocks.blockedId, ids))
    );
  for (const r of blocks) out.set(r.blocked, "blocked");

  return out;
}

/**
 * Detail relasi untuk halaman profil: status + id request pending (kalau ada)
 * supaya UI bisa langsung accept/cancel tanpa lookup lagi.
 */
export async function getRelationshipDetail(
  viewerId: string,
  otherId: string
): Promise<{ status: RelationshipStatus; pendingRequestId: string | null }> {
  const me = viewerId.toLowerCase();
  const other = otherId.toLowerCase();
  const status = await getRelationship(me, other);
  if (status !== "pending_in" && status !== "pending_out") {
    return { status, pendingRequestId: null };
  }
  const [req] = await db
    .select({ id: friendRequests.id })
    .from(friendRequests)
    .where(
      and(
        eq(
          friendRequests.requesterId,
          status === "pending_out" ? me : other
        ),
        eq(
          friendRequests.addresseeId,
          status === "pending_out" ? other : me
        ),
        eq(friendRequests.status, "pending")
      )
    )
    .limit(1);
  return { status, pendingRequestId: req?.id ?? null };
}

export async function getRelationship(
  viewerId: string,
  otherId: string
): Promise<RelationshipStatus> {
  const map = await getRelationshipMap(viewerId, [otherId]);
  return map.get(otherId.toLowerCase()) ?? "none";
}

// ============================================================
// GUARD TARGET
// ============================================================

/**
 * Validasi target aksi pertemanan (PRD 10.1): ada, bukan guest (walk-in tak
 * bisa login -> request menggantung selamanya), aktif, bukan staff (kalau
 * lolos, staff jadi kandidat undangan meja "friends" — bypass exclusion).
 * Throw dengan pesan jelas; TIDAK memeriksa blokir (blokir = silent, PRD 7.3).
 */
export async function assertFriendableTarget(targetId: string): Promise<void> {
  const [target] = await db
    .select({ isGuest: profiles.isGuest, isActive: profiles.isActive })
    .from(profiles)
    .where(eq(profiles.id, targetId));
  if (!target || target.isGuest || !target.isActive) {
    throw new Error("User not found");
  }
  const [staff] = await db
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(and(eq(staffRoles.profileId, targetId), eq(staffRoles.isActive, true)))
    .limit(1);
  if (staff) throw new Error("User not found");
}

// ============================================================
// ANTI-SPAM (PRD 6.4 / K8)
// ============================================================

export const DAILY_OUTGOING_QUOTA = 20; // request keluar / 24 jam

/** Jumlah request KELUAR dalam 24 jam terakhir (kuota harian). */
export async function countOutgoingLast24h(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.requesterId, userId),
        gt(friendRequests.createdAt, since)
      )
    );
  return Number(row?.n ?? 0);
}
