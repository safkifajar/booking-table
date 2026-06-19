/**
 * Server-side data fetching helpers (read queries).
 *
 * Migrated dari Supabase client ke Drizzle ORM (Phase 3).
 *
 * Return shape tetap snake_case match `@/types/db` interface supaya
 * page-page consumer tidak perlu diubah. Mapping camelCase (Drizzle)
 * → snake_case (types) terjadi di sini sebagai translation layer.
 *
 * Phase 5 cleanup nanti baru migrate types ke camelCase kalau diputuskan.
 */

import { eq, and, inArray, asc, sql, lte, gt, ne, or, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bars, floorAreas, tables } from "@/lib/db/schema/venue";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { menuCategories, menuItems } from "@/lib/db/schema/menu";
import { profiles } from "@/lib/db/schema/profiles";
import { memberRatings } from "@/lib/db/schema/extras";
import type {
  Bar,
  FloorArea,
  BarTable,
  ActiveSessionView,
  MenuCategory,
  MenuItem,
  RatableMember,
  UserRatingSummary,
  ActiveNetworkUser,
  PublicProfile,
} from "@/types/db";

// ============================================================
// VENUE (bars, areas, tables)
// ============================================================

export async function getBarBySlug(slug: string): Promise<Bar | null> {
  const row = await db.query.bars.findFirst({
    where: eq(bars.slug, slug),
  });
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    address: row.address,
    logo_url: row.logoUrl,
    cover_url: row.coverUrl,
    theme: row.theme as Record<string, string>,
    opening_hours: row.openingHours as Record<string, string>,
    created_at: row.createdAt.toISOString(),
  };
}

export async function getFloorAreas(barId: string): Promise<FloorArea[]> {
  const rows = await db.query.floorAreas.findMany({
    where: eq(floorAreas.barId, barId),
    orderBy: asc(floorAreas.sortOrder),
  });
  return rows.map((row) => ({
    id: row.id,
    bar_id: row.barId,
    name: row.name,
    slug: row.slug,
    canvas_width: row.canvasWidth,
    canvas_height: row.canvasHeight,
    background_url: row.backgroundUrl,
    sort_order: row.sortOrder,
    created_at: row.createdAt.toISOString(),
  }));
}

export async function getTablesByArea(areaId: string): Promise<BarTable[]> {
  const rows = await db.query.tables.findMany({
    // Customer: hanya meja aktif & sudah publish (bukan draft).
    where: and(
      eq(tables.areaId, areaId),
      eq(tables.isActive, true),
      eq(tables.isDraft, false)
    ),
    orderBy: asc(tables.label),
  });
  return rows.map((row) => ({
    id: row.id,
    area_id: row.areaId,
    label: row.label,
    shape: row.shape,
    capacity: row.capacity,
    pos_x: row.posX,
    pos_y: row.posY,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    is_active: row.isActive,
    min_spend: row.minSpend,
    created_at: row.createdAt.toISOString(),
  }));
}

/**
 * Tables untuk floor EDITOR (admin): sertakan draft posisi. pos_x/pos_y di sini
 * = draft kalau ada (supaya editor lanjut dari posisi draft terakhir), draft_*
 * = nilai mentah untuk tahu apakah ada perubahan belum di-publish.
 */
export async function getTablesByAreaForEditor(
  areaId: string
): Promise<BarTable[]> {
  const rows = await db.query.tables.findMany({
    where: eq(tables.areaId, areaId),
    orderBy: asc(tables.label),
  });
  return rows.map((row) => ({
    id: row.id,
    area_id: row.areaId,
    label: row.label,
    shape: row.shape,
    capacity: row.capacity,
    // Editor lanjut dari draft kalau ada.
    pos_x: row.draftPosX ?? row.posX,
    pos_y: row.draftPosY ?? row.posY,
    draft_pos_x: row.draftPosX,
    draft_pos_y: row.draftPosY,
    is_draft: row.isDraft,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    is_active: row.isActive,
    min_spend: row.minSpend,
    created_at: row.createdAt.toISOString(),
  }));
}

// ============================================================
// ACTIVE SESSIONS (replaces v_active_sessions view)
// ============================================================

/**
 * Query v_active_sessions equivalent: join table_sessions + tables + areas + host profile,
 * filter status 'open' atau 'locked', filter by bar via area→bar relation.
 *
 * member_count di-compute via subquery COUNT.
 */
async function activeSessionsBase(): Promise<
  (ActiveSessionView & { bar_id: string })[]
> {
  // Subquery untuk member count
  const memberCountSq = db
    .select({
      sessionId: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`.as("member_count"),
    })
    .from(sessionMembers)
    .where(eq(sessionMembers.status, "joined"))
    .groupBy(sessionMembers.sessionId)
    .as("mc");

  const rows = await db
    .select({
      id: tableSessions.id,
      table_id: tableSessions.tableId,
      table_label: tables.label,
      area_id: tables.areaId,
      area_name: floorAreas.name,
      status: tableSessions.status,
      visibility: tableSessions.visibility,
      title: tableSessions.title,
      vibe_tags: tableSessions.vibeTags,
      host_id: tableSessions.hostId,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
      started_at: tableSessions.startedAt,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      member_count: sql<number>`COALESCE(${memberCountSq.count}, 0)::int`,
      table_capacity: tables.capacity,
      bar_id: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .leftJoin(memberCountSq, eq(memberCountSq.sessionId, tableSessions.id))
    .where(
      inArray(tableSessions.status, ["reserved", "open", "locked", "overdue"])
    );

  return rows.map((r) => ({
    ...r,
    started_at: r.started_at.toISOString(),
    reservation_at: r.reservation_at ? r.reservation_at.toISOString() : null,
    reservation_end_at: r.reservation_end_at
      ? r.reservation_end_at.toISOString()
      : null,
  }));
}

export async function getActiveSessionsByBar(
  barId: string
): Promise<ActiveSessionView[]> {
  const all = await activeSessionsBase();
  return all.filter((s) => s.bar_id === barId).map(({ bar_id: _b, ...rest }) => rest);
}

export async function getActiveSessionsForArea(
  areaId: string
): Promise<ActiveSessionView[]> {
  const all = await activeSessionsBase();
  return all.filter((s) => s.area_id === areaId).map(({ bar_id: _b, ...rest }) => rest);
}

/**
 * Tutup session yang sudah selesai (lazy, dipanggil saat floor di-load):
 * - Session hasil reservasi (punya reservation_end_at): close kalau
 *   reservation_end_at <= now. Meja jadi available (atau reserved kalau ada
 *   booking berikutnya yg belum due — itu tetap 'reserved' di tabel).
 * - Walk-in basi (reservation_at NULL, open): close kalau started_at sudah
 *   lebih dari WALKIN_MAX_HOURS jam lalu (sisa sesi yg lupa ditutup).
 *
 * Return jumlah session yang di-close.
 */
const WALKIN_MAX_HOURS = 12;

/**
 * Map sessionId → outstanding (sisa tagihan) = subtotal order_items non-void −
 * total payments berstatus 'paid'. Hanya untuk sessionIds yang diberikan.
 * Session tanpa order dianggap outstanding 0. Reuse pola cashier-actions.
 */
export async function getOutstandingMap(
  sessionIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sessionIds.length === 0) return out;

  const bills = await db
    .select({
      session_id: orders.sessionId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orders)
    .leftJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
    )
    .where(inArray(orders.sessionId, sessionIds))
    .groupBy(orders.sessionId);

  const paidRows = await db
    .select({
      session_id: orders.sessionId,
      paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(inArray(orders.sessionId, sessionIds), eq(payments.status, "paid"))
    )
    .groupBy(orders.sessionId);

  const paidMap = new Map(paidRows.map((r) => [r.session_id, Number(r.paid)]));
  for (const b of bills) {
    const outstanding = Math.max(
      0,
      Number(b.subtotal) - (paidMap.get(b.session_id) ?? 0)
    );
    out.set(b.session_id, outstanding);
  }
  return out;
}

/**
 * Kalau session berstatus 'overdue' dan tagihannya sudah lunas (outstanding
 * <= 0), tutup jadi 'closed'. Dipanggil setelah pembayaran berhasil (payShare /
 * cashier mark-paid). No-op kalau session bukan overdue atau masih ada sisa.
 */
export interface UnpaidSessionView {
  id: string;
  table_label: string;
  area_name: string;
  bar_name: string;
  status: string;
  started_at: string;
  outstanding: number;
}

/**
 * Sesi yang DIIKUTI user (host atau member non-pending) dan masih punya tagihan
 * belum lunas (outstanding > 0). Mencakup status 'overdue' (lewat waktu tapi
 * nunggak) maupun 'closed' yang di-close paksa dengan sisa. Dipakai untuk banner
 * "tagihan belum lunas" + badge riwayat. Dibatasi 60 hari terakhir.
 */
export async function getUnpaidSessionsForProfile(
  profileId: string
): Promise<UnpaidSessionView[]> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const rows = await db
    .selectDistinct({
      id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      bar_name: bars.name,
      status: tableSessions.status,
      started_at: tableSessions.startedAt,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .leftJoin(
      sessionMembers,
      and(
        eq(sessionMembers.sessionId, tableSessions.id),
        eq(sessionMembers.profileId, profileId)
      )
    )
    .where(
      and(
        inArray(tableSessions.status, ["overdue", "closed"]),
        gt(tableSessions.startedAt, since),
        or(
          eq(tableSessions.hostId, profileId),
          and(
            eq(sessionMembers.profileId, profileId),
            ne(sessionMembers.status, "pending")
          )
        )
      )
    )
    .orderBy(desc(tableSessions.startedAt))
    .limit(50);

  if (rows.length === 0) return [];
  const outMap = await getOutstandingMap(rows.map((r) => r.id));
  return rows
    .map((r) => ({
      id: r.id,
      table_label: r.table_label,
      area_name: r.area_name,
      bar_name: r.bar_name,
      status: r.status as string,
      started_at: r.started_at.toISOString(),
      outstanding: outMap.get(r.id) ?? 0,
    }))
    .filter((r) => r.outstanding > 0);
}

export async function settleOverdueIfPaid(sessionId: string): Promise<boolean> {
  const [s] = await db
    .select({ status: tableSessions.status })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!s || s.status !== "overdue") return false;

  const outstanding = (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
  if (outstanding > 0) return false;

  await db
    .update(tableSessions)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(tableSessions.id, sessionId));
  return true;
}

export async function expireFinishedSessions(barId: string): Promise<number> {
  const now = new Date();
  const walkinCutoff = new Date(now.getTime() - WALKIN_MAX_HOURS * 60 * 60 * 1000);

  // Ambil semua session aktif (reserved/open/locked) milik bar ini.
  const active = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      startedAt: tableSessions.startedAt,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        inArray(tableSessions.status, ["reserved", "open", "locked"])
      )
    );

  // Kandidat yg waktunya habis (reservasi lewat / walk-in basi).
  const expiring = active.filter((s) => {
    const reservationEnded =
      !!s.reservationEndAt && s.reservationEndAt.getTime() <= now.getTime();
    const staleWalkIn =
      s.status !== "reserved" &&
      !s.reservationAt &&
      s.startedAt.getTime() <= walkinCutoff.getTime();
    return reservationEnded || staleWalkIn;
  });
  if (expiring.length === 0) return 0;

  // Cek tagihan: yg masih ada sisa → 'overdue' (jangan close, biar tetap
  // tertagih). Yg lunas / tanpa tagihan → 'closed' seperti biasa.
  const outstandingMap = await getOutstandingMap(expiring.map((s) => s.id));

  let processed = 0;
  for (const s of expiring) {
    const outstanding = outstandingMap.get(s.id) ?? 0;
    if (outstanding > 0) {
      await db
        .update(tableSessions)
        .set({ status: "overdue" })
        .where(eq(tableSessions.id, s.id));
    } else {
      await db
        .update(tableSessions)
        .set({ status: "closed", closedAt: now })
        .where(eq(tableSessions.id, s.id));
    }
    processed++;
  }
  return processed;
}

/**
 * Promote reservasi yang waktunya SUDAH TIBA (reservation_at <= now dan
 * reservation_end_at > now) dari status 'reserved' → 'open'. Dipanggil lazy
 * saat floor view di-load (tanpa cron). Meja yang sudah punya session
 * open/locked lain tidak dipromote (cegah konflik unique index).
 *
 * Return jumlah session yang dipromote.
 */
export async function promoteDueReservations(barId: string): Promise<number> {
  const now = new Date();
  // Cari reservasi due milik bar ini, yang mejanya belum punya session
  // open/locked aktif.
  const due = await db
    .select({ id: tableSessions.id, tableId: tableSessions.tableId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        eq(tableSessions.status, "reserved"),
        lte(tableSessions.reservationAt, now),
        gt(tableSessions.reservationEndAt, now)
      )
    );
  if (due.length === 0) return 0;

  let promoted = 0;
  for (const r of due) {
    // Skip kalau meja sudah punya session open/locked lain.
    const [busy] = await db
      .select({ id: tableSessions.id })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tableId, r.tableId),
          inArray(tableSessions.status, ["open", "locked"])
        )
      );
    if (busy) continue;
    try {
      await db
        .update(tableSessions)
        .set({ status: "open", startedAt: now })
        .where(eq(tableSessions.id, r.id));
      promoted++;
    } catch {
      // Konflik unique index (race) — abaikan, biar tetap reserved.
    }
  }
  return promoted;
}

/**
 * Promote SATU sesi reservasi spesifik kalau waktunya sudah tiba (reserved &
 * reservation_at <= now < reservation_end_at) & mejanya belum dipakai sesi
 * open/locked/overdue lain. Dipakai saat buka /session/[id] supaya status fresh
 * (denah & tombol gabung bergantung status 'open') tanpa harus reload denah.
 * Return true kalau ter-promote.
 */
export async function promoteSessionIfDue(sessionId: string): Promise<boolean> {
  const now = new Date();
  const [s] = await db
    .select({
      id: tableSessions.id,
      tableId: tableSessions.tableId,
      status: tableSessions.status,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
    })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (
    !s ||
    s.status !== "reserved" ||
    !s.reservationAt ||
    !s.reservationEndAt ||
    s.reservationAt.getTime() > now.getTime() ||
    s.reservationEndAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  // Meja dipakai sesi aktif lain (open/locked)? jangan promote (cegah konflik
  // index). 'overdue' TIDAK menghalangi — itu hutang lama, bukan okupansi fisik.
  const [busy] = await db
    .select({ id: tableSessions.id })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tableId, s.tableId),
        inArray(tableSessions.status, ["open", "locked"])
      )
    );
  if (busy) return false;
  try {
    await db
      .update(tableSessions)
      .set({ status: "open", startedAt: now })
      .where(
        and(eq(tableSessions.id, sessionId), eq(tableSessions.status, "reserved"))
      );
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// MENU
// ============================================================

export async function getMenuByBar(
  barId: string
): Promise<Array<MenuCategory & { items: MenuItem[] }>> {
  const categories = await db.query.menuCategories.findMany({
    where: and(eq(menuCategories.barId, barId), eq(menuCategories.isActive, true)),
    orderBy: asc(menuCategories.sortOrder),
  });

  if (categories.length === 0) return [];

  const items = await db.query.menuItems.findMany({
    where: inArray(
      menuItems.categoryId,
      categories.map((c) => c.id)
    ),
    orderBy: asc(menuItems.sortOrder),
  });

  return categories.map((cat) => ({
    id: cat.id,
    bar_id: cat.barId,
    name: cat.name,
    slug: cat.slug,
    sort_order: cat.sortOrder,
    is_active: cat.isActive,
    created_at: cat.createdAt.toISOString(),
    items: items
      .filter((i) => i.categoryId === cat.id)
      .map((i) => ({
        id: i.id,
        category_id: i.categoryId,
        name: i.name,
        description: i.description,
        price: i.price,
        image_url: i.imageUrl,
        tags: i.tags,
        is_available: i.isAvailable,
        prep_minutes: i.prepMinutes ?? 0,
        sort_order: i.sortOrder,
        created_at: i.createdAt.toISOString(),
      })),
  }));
}

// ============================================================
// RATINGS
// ============================================================

/**
 * Get ratable members for a session: semua members (joined + left)
 * KECUALI self. Setiap row carry `already_rated` flag.
 *
 * Original Supabase RPC: get_ratable_members(p_session_id) yang pakai
 * `auth.uid()` implisit. Drizzle version harus pass `raterId` eksplisit.
 *
 * Shape sama dengan RPC original:
 * - member_id = session_members.id (untuk action callback)
 * - already_rated dihitung lewat correlated subquery
 *
 * NOTE: signature berubah — callers harus update pass raterId.
 */
export async function getRatableMembers(
  sessionId: string,
  raterId: string
): Promise<RatableMember[]> {
  const rows = await db
    .select({
      member_id: sessionMembers.id,
      profile_id: profiles.id,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
      already_rated: sql<boolean>`EXISTS (
        SELECT 1 FROM ${memberRatings} mr
        WHERE mr.session_id = ${sessionId}
          AND mr.rater_id = ${raterId}
          AND mr.ratee_id = ${profiles.id}
      )`,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        inArray(sessionMembers.status, ["joined", "left"]),
        sql`${sessionMembers.profileId} <> ${raterId}`
      )
    );

  return rows;
}

/**
 * Aggregate rating for a profile across all sessions.
 *
 * Original RPC: get_user_rating(p_profile_id) — return avg_stars, rating_count,
 * top_tags (top 3 array). Drizzle version replicate same shape.
 */
export async function getUserRating(
  profileId: string
): Promise<UserRatingSummary> {
  const [agg] = await db
    .select({
      avg_stars: sql<number>`COALESCE(ROUND(AVG(${memberRatings.stars})::numeric, 1), 0)`,
      rating_count: sql<number>`COUNT(*)::int`,
      top_tags: sql<string[] | null>`(
        SELECT array_agg(tag ORDER BY cnt DESC)
        FROM (
          SELECT tag, COUNT(*) AS cnt
          FROM ${memberRatings} mr
          CROSS JOIN LATERAL unnest(mr.tags) AS tag
          WHERE mr.ratee_id = ${profileId}
          GROUP BY tag
          ORDER BY cnt DESC
          LIMIT 3
        ) t
      )`,
    })
    .from(memberRatings)
    .where(eq(memberRatings.rateeId, profileId));

  return {
    avg_stars: Number(agg?.avg_stars ?? 0),
    rating_count: agg?.rating_count ?? 0,
    top_tags: agg?.top_tags ?? null,
  };
}

export async function getUserRatingsBatch(
  profileIds: string[]
): Promise<Record<string, UserRatingSummary>> {
  if (profileIds.length === 0) return {};
  const result: Record<string, UserRatingSummary> = {};
  await Promise.all(
    profileIds.map(async (id) => {
      result[id] = await getUserRating(id);
    })
  );
  return result;
}

// ============================================================
// NETWORK (siapa yg lagi di SOHO + profil publik user)
// ============================================================

/**
 * Hobi yg paling banyak dipakai member (non-guest), urut frekuensi. Untuk chip
 * filter di tab "Semua member" /network. Unnest array hobbies lalu hitung.
 */
export async function getPopularHobbies(limit = 12): Promise<string[]> {
  const rows = await db
    .select({
      hobby: sql<string>`hobby`,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(
      sql`(SELECT unnest(${profiles.hobbies}) AS hobby FROM ${profiles} WHERE ${profiles.isGuest} = false) AS h`
    )
    .groupBy(sql`hobby`)
    .orderBy(sql`COUNT(*) DESC`, sql`hobby ASC`)
    .limit(limit);
  return rows.map((r) => r.hobby).filter(Boolean);
}

/**
 * Daftar user yg sedang nongkrong di meja AKTIF (open/locked) di bar. Termasuk
 * host (role host) & member joined. Exclude guest placeholder (walk-in tanpa
 * akun). Untuk halaman /network section "Lagi di SOHO".
 *
 * 'overdue' SENGAJA dikecualikan: itu hutang lewat-waktu, bukan jaminan orang
 * masih fisik di meja (bisa sudah pulang) — konsisten dgn denah yg juga
 * menyembunyikan overdue.
 *
 * Satu user bisa muncul di >1 sesi (jarang) — di-dedupe per profil, ambil
 * sesi pertama (yg join paling awal).
 */
export async function getActiveUsersAtBar(
  barId: string
): Promise<ActiveNetworkUser[]> {
  const rows = await db
    .select({
      profile_id: profiles.id,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
      session_id: tableSessions.id,
      table_label: tables.label,
      visibility: tableSessions.visibility,
      host_id: tableSessions.hostId,
      joined_at: sessionMembers.joinedAt,
    })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        inArray(tableSessions.status, ["open", "locked"]),
        eq(sessionMembers.status, "joined"),
        eq(profiles.isGuest, false)
      )
    )
    .orderBy(asc(sessionMembers.joinedAt));

  const seen = new Set<string>();
  const out: ActiveNetworkUser[] = [];
  for (const r of rows) {
    if (seen.has(r.profile_id)) continue;
    seen.add(r.profile_id);
    out.push({
      profile_id: r.profile_id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      session_id: r.session_id,
      table_label: r.table_label,
      visibility: r.visibility as ActiveNetworkUser["visibility"],
      is_host: r.host_id === r.profile_id,
    });
  }
  return out;
}

/** Berapa kali user pernah jadi member meja (joined/left) = jumlah kunjungan. */
async function getVisitCount(profileId: string): Promise<number> {
  const [agg] = await db
    .select({ c: sql<number>`COUNT(DISTINCT ${sessionMembers.sessionId})::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.profileId, profileId),
        inArray(sessionMembers.status, ["joined", "left"])
      )
    );
  return agg?.c ?? 0;
}

/**
 * Detail profil publik user lain (untuk /network/[userId]): profil + rating +
 * jumlah kunjungan + sesi aktif sekarang (kalau lagi nongkrong). Exclude staff
 * via caller (atau biarkan — profil tetap publik). Null kalau user guest/not found.
 */
export async function getPublicProfile(
  userId: string
): Promise<PublicProfile | null> {
  const [p] = await db
    .select({
      id: profiles.id,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
      bio: profiles.bio,
      hobbies: profiles.hobbies,
      is_guest: profiles.isGuest,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));
  if (!p || p.is_guest) return null;

  const [rating, visit_count, active] = await Promise.all([
    getUserRating(userId),
    getVisitCount(userId),
    db
      .select({
        session_id: tableSessions.id,
        table_label: tables.label,
        visibility: tableSessions.visibility,
      })
      .from(sessionMembers)
      .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .where(
        and(
          eq(sessionMembers.profileId, userId),
          eq(sessionMembers.status, "joined"),
          // open/locked saja — lihat catatan di getActiveUsersAtBar.
          inArray(tableSessions.status, ["open", "locked"])
        )
      )
      .orderBy(asc(sessionMembers.joinedAt))
      .limit(1),
  ]);

  return {
    id: p.id,
    display_name: p.display_name,
    avatar_url: p.avatar_url,
    bio: p.bio,
    hobbies: p.hobbies,
    rating,
    visit_count,
    active_session: active[0]
      ? {
          session_id: active[0].session_id,
          table_label: active[0].table_label,
          visibility: active[0].visibility as ActiveNetworkUser["visibility"],
        }
      : null,
  };
}
