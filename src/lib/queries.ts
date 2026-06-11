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

import { eq, and, inArray, asc, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bars, floorAreas, tables } from "@/lib/db/schema/venue";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
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
    where: and(eq(tables.areaId, areaId), eq(tables.isActive, true)),
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
      member_count: sql<number>`COALESCE(${memberCountSq.count}, 0)::int`,
      table_capacity: tables.capacity,
      bar_id: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .leftJoin(memberCountSq, eq(memberCountSq.sessionId, tableSessions.id))
    .where(inArray(tableSessions.status, ["open", "locked"]));

  return rows.map((r) => ({
    ...r,
    started_at: r.started_at.toISOString(),
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
