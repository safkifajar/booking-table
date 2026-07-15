import "server-only";

/**
 * Helper terpusat membership (PRD Membership, prinsip #2).
 *
 * ATURAN KERAS: semua pengecekan level/visibilitas lewat file ini — jangan
 * bandingkan profiles.membership_level mentah di tempat lain. Dua alasan:
 * 1. Level EFEKTIF ≠ level tersimpan: expires_at lewat → efektif 'basic'
 *    (lazy downgrade, tanpa cron — PRD 4.2). Pembacaan mentah = member
 *    kedaluwarsa masih dianggap premium.
 * 2. Perbandingan visibilitas HARUS memakai level efektif KEDUA SISI
 *    (PRD 8) — satu sisi saja = kebocoran.
 *
 * Rank hard-coded (M2: jumlah level & rank immutable di v1); tabel
 * membership_levels hanya untuk data tampilan (nama/harga/periode) yang
 * dikelola admin.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { membershipLevels } from "@/lib/db/schema/membership";
import { profiles } from "@/lib/db/schema/profiles";

// ============================================================
// RANK — konstanta kode, bukan bacaan DB
// ============================================================

export const MEMBERSHIP_RANK = { basic: 1, premium: 2, vip: 3 } as const;
export type MembershipKey = keyof typeof MEMBERSHIP_RANK;

export const MEMBERSHIP_KEYS = ["basic", "premium", "vip"] as const;

function isMembershipKey(v: string | null | undefined): v is MembershipKey {
  return v === "basic" || v === "premium" || v === "vip";
}

// ============================================================
// LEVEL EFEKTIF (pure — bisa dipakai atas row profil yang sudah di tangan)
// ============================================================

/**
 * Level EFEKTIF dari kolom tersimpan: kedaluwarsa (atau key tak dikenal)
 * → 'basic'. expiresAt NULL = tanpa batas (basic / lifetime).
 */
export function effectiveLevelKey(
  storedLevel: string | null | undefined,
  expiresAt: Date | null | undefined
): MembershipKey {
  if (!isMembershipKey(storedLevel)) return "basic";
  if (storedLevel === "basic") return "basic";
  if (expiresAt != null && expiresAt.getTime() < Date.now()) return "basic";
  return storedLevel;
}

export function effectiveRank(
  storedLevel: string | null | undefined,
  expiresAt: Date | null | undefined
): number {
  return MEMBERSHIP_RANK[effectiveLevelKey(storedLevel, expiresAt)];
}

/**
 * Aturan visibilitas inti (M4): kamu melihat level-mu dan di bawahnya.
 * CATATAN: teman & blokir dicek DI LUAR fungsi ini oleh pemanggil —
 * teman selalu saling terlihat (G2), blokir selalu menang.
 */
export function canSeeRank(viewerRank: number, targetRank: number): boolean {
  return viewerRank >= targetRank;
}

/**
 * Ekspresi SQL rank EFEKTIF (versi SQL dari effectiveRank) — untuk ORDER BY /
 * WHERE di query daftar (mis. urutan Network VIP → Premium → Basic) tanpa
 * round-trip tambahan. HARUS setara dgn effectiveLevelKey: kedaluwarsa = 1.
 */
export function sqlEffectiveRank() {
  return sql<number>`CASE
    WHEN ${profiles.membershipExpiresAt} IS NOT NULL
      AND ${profiles.membershipExpiresAt} < now() THEN 1
    WHEN ${profiles.membershipLevel} = 'vip' THEN 3
    WHEN ${profiles.membershipLevel} = 'premium' THEN 2
    ELSE 1
  END`;
}

// ============================================================
// BACA DB
// ============================================================

/** Rank efektif satu profil (utk guard tunggal). Tak ditemukan → basic. */
export async function getEffectiveRankOf(profileId: string): Promise<number> {
  const [row] = await db
    .select({
      level: profiles.membershipLevel,
      expiresAt: profiles.membershipExpiresAt,
    })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  return effectiveRank(row?.level, row?.expiresAt);
}

/**
 * Rank efektif BANYAK profil sekaligus — satu query (PRD 10.4 pola Friends:
 * jangan per-baris). Untuk menyaring/mengunci daftar (Network, story,
 * kandidat undangan). Id yang tak ditemukan tak ada di map → perlakukan
 * sebagai basic oleh pemanggil bila perlu.
 */
export async function getEffectiveRankMap(
  profileIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (profileIds.length === 0) return out;
  const rows = await db
    .select({
      id: profiles.id,
      level: profiles.membershipLevel,
      expiresAt: profiles.membershipExpiresAt,
    })
    .from(profiles)
    .where(inArray(profiles.id, profileIds));
  for (const r of rows) out.set(r.id, effectiveRank(r.level, r.expiresAt));
  return out;
}

// ============================================================
// DATA TAMPILAN (nama/harga/periode — dikelola admin)
// ============================================================

export interface MembershipLevelRow {
  key: MembershipKey;
  rank: number;
  name: string;
  price: number;
  billing_period: "one_time" | "monthly" | "yearly";
  description: string | null;
  is_purchasable: boolean;
}

/** Semua level urut rank — untuk halaman beli & admin. */
export async function getMembershipLevels(): Promise<MembershipLevelRow[]> {
  const rows = await db
    .select({
      key: membershipLevels.key,
      rank: membershipLevels.rank,
      name: membershipLevels.name,
      price: membershipLevels.price,
      billing_period: membershipLevels.billingPeriod,
      description: membershipLevels.description,
      is_purchasable: membershipLevels.isPurchasable,
    })
    .from(membershipLevels)
    .orderBy(membershipLevels.rank);
  return rows.filter((r): r is MembershipLevelRow => isMembershipKey(r.key));
}

/** Status membership seorang user untuk badge/halaman status. */
export interface MembershipStatus {
  key: MembershipKey;
  /** Nama tampilan level EFEKTIF (bisa diganti admin). */
  name: string;
  rank: number;
  /** NULL = tanpa batas (basic / lifetime). */
  expires_at: Date | null;
  /** True kalau level tersimpan berbayar tapi sudah lewat → efektif basic. */
  expired: boolean;
}

export async function getMembershipStatus(
  profileId: string
): Promise<MembershipStatus> {
  const [row] = await db
    .select({
      level: profiles.membershipLevel,
      expiresAt: profiles.membershipExpiresAt,
    })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  const effective = effectiveLevelKey(row?.level, row?.expiresAt);
  const expired = isMembershipKey(row?.level)
    ? row!.level !== "basic" && effective === "basic"
    : false;
  const [level] = await db
    .select({ name: membershipLevels.name })
    .from(membershipLevels)
    .where(eq(membershipLevels.key, effective))
    .limit(1);
  return {
    key: effective,
    name: level?.name ?? effective,
    rank: MEMBERSHIP_RANK[effective],
    expires_at: effective === "basic" ? null : (row?.expiresAt ?? null),
    expired,
  };
}
