"use server";

/**
 * Server Actions untuk Story feature.
 *
 * Dipisah dari actions.ts (yang sudah 900+ baris) supaya gampang maintain.
 */

import { revalidatePath } from "next/cache";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { stories, storyViews } from "@/lib/db/schema/stories";
import { profiles } from "@/lib/db/schema/profiles";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { requireProfile } from "@/lib/auth-v2/current";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";

// ============================================================
// VALIDATION
// ============================================================

const ACCEPTED_STORY_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
const MAX_STORY_BYTES = 10 * 1024 * 1024; // 10MB

function isHeicFile(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

const captionSchema = z.string().max(280, "Caption maks 280 karakter").optional();
const barIdSchema = z.string().uuid();

// ============================================================
// CREATE STORY
// ============================================================

/**
 * Upload story baru.
 *
 * Pakai FormData supaya bisa terima File langsung dari client.
 * Field:
 * - file: File (image, max 10MB, JPG/PNG/WebP/HEIC)
 * - caption: string optional (max 280 char)
 * - barId: string uuid (which bar story is for)
 *
 * Auto-tag tableSessionId kalau user lagi joined di session aktif di bar
 * tersebut (ambil yang status='joined' paling baru).
 *
 * Expire: 24 jam dari created_at (default di schema).
 */
export async function createStory(formData: FormData): Promise<{ id: string }> {
  const profile = await requireProfile();
  const file = formData.get("file");
  const captionInput = formData.get("caption");
  const barIdInput = formData.get("barId");

  if (!(file instanceof File)) throw new Error("File tidak valid");
  if (file.size === 0) throw new Error("File kosong");
  if (file.size > MAX_STORY_BYTES) {
    throw new Error(
      `File terlalu besar (max ${Math.floor(MAX_STORY_BYTES / 1024 / 1024)}MB)`
    );
  }

  const heic = isHeicFile(file);
  const validMime = ACCEPTED_STORY_TYPES.includes(
    file.type as (typeof ACCEPTED_STORY_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("Format file harus JPG, PNG, WebP, atau HEIC");
  }

  const caption = captionSchema.parse(
    typeof captionInput === "string" ? captionInput.trim() || undefined : undefined
  );
  const barId = barIdSchema.parse(barIdInput);

  // Process image: HEIC → JPEG kalau perlu → sharp resize portrait crop
  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  // Story portrait 1080×1920 (9:16) — match IG story dimension.
  // Fit "inside" supaya tidak crop ekstrem, max 1080w atau 1920h.
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(1080, 1920, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  // Auto-tag table session kalau user lagi joined di bar ini
  const [activeMembership] = await db
    .select({ session_id: tableSessions.id })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined"),
        eq(floorAreas.barId, barId),
        sql`${tableSessions.status} IN ('open', 'locked', 'overdue')`
      )
    )
    .orderBy(desc(sessionMembers.joinedAt))
    .limit(1);

  // Insert story row (id dipakai sebagai storage key — unique + immutable)
  const [newStory] = await db
    .insert(stories)
    .values({
      userId: profile.id,
      barId,
      tableSessionId: activeMembership?.session_id ?? null,
      caption: caption ?? null,
      imageUrl: "PENDING", // placeholder, update setelah upload
    })
    .returning({ id: stories.id });

  // Upload ke storage dengan story id sebagai key
  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "stories",
    key: newStory.id,
    contentType: "image/webp",
  });

  // Update row dengan URL final
  await db
    .update(stories)
    .set({ imageUrl: publicUrl })
    .where(eq(stories.id, newStory.id));

  // Notify bar channel supaya semua viewer di bar dapat update realtime
  await notify(channels.bar(barId), { type: "story.new", storyId: newStory.id });

  revalidatePath("/", "layout");

  return { id: newStory.id };
}

// ============================================================
// DELETE STORY
// ============================================================

/**
 * Hapus story (cuma owner).
 *
 * Hapus row + file dari storage. story_views ter-cascade.
 */
export async function deleteStory(storyId: string): Promise<void> {
  const profile = await requireProfile();
  const { storage } = await import("@/lib/storage");

  const [story] = await db
    .select({
      userId: stories.userId,
      barId: stories.barId,
      imageUrl: stories.imageUrl,
    })
    .from(stories)
    .where(eq(stories.id, storyId));

  if (!story) throw new Error("Story tidak ditemukan");
  if (story.userId !== profile.id) {
    throw new Error("Hanya pemilik yang bisa hapus");
  }

  // Hapus file dulu (best-effort), lalu row
  await storage.delete(story.imageUrl);
  await db.delete(stories).where(eq(stories.id, storyId));

  await notify(channels.bar(story.barId), {
    type: "story.delete",
    storyId,
  });

  revalidatePath("/", "layout");
}

// ============================================================
// MARK VIEWED
// ============================================================

/**
 * Track bahwa user lihat story tertentu.
 * Idempotent — duplicate insert silently ignored.
 * Tidak update untuk owner sendiri.
 */
export async function markStoryAsViewed(storyId: string): Promise<void> {
  const profile = await requireProfile();

  // Cek kalau viewer adalah owner — skip
  const [story] = await db
    .select({ userId: stories.userId, barId: stories.barId })
    .from(stories)
    .where(eq(stories.id, storyId));
  if (!story) return;
  if (story.userId === profile.id) return;

  await db
    .insert(storyViews)
    .values({ storyId, viewerId: profile.id })
    .onConflictDoNothing();

  // Notify owner (lewat bar channel — owner-side filter via UI/viewer count)
  await notify(channels.bar(story.barId), {
    type: "story.view",
    storyId,
  });
}

// ============================================================
// READ HELPERS (untuk page Server Components)
// ============================================================

/**
 * Story user untuk display di story bar — grouped by user, ambil
 * yang masih aktif (belum expired).
 *
 * Return: per-user array, latest story per user di atas.
 */
export interface StoryBarItem {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  storyCount: number;
  /** True kalau viewer sudah lihat SEMUA story user ini */
  allViewed: boolean;
  /** ID story pertama untuk klik action */
  firstStoryId: string;
}

export async function getActiveStoriesByBar(
  barId: string,
  viewerId: string
): Promise<StoryBarItem[]> {
  // Pendekatan: ambil semua story aktif + viewedByMe flag per story (LEFT JOIN
  // ke story_views), group di JS supaya tidak perlu correlated subquery yang
  // bermasalah di Drizzle.
  const now = new Date();

  const rows = await db
    .select({
      id: stories.id,
      userId: stories.userId,
      createdAt: stories.createdAt,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      // viewedByMe via subquery non-correlated (literal viewerId) — aman
      viewedByMe: sql<boolean>`EXISTS (
        SELECT 1 FROM ${storyViews} sv
        WHERE sv.story_id = ${stories.id} AND sv.viewer_id = ${viewerId}
      )`,
    })
    .from(stories)
    .innerJoin(profiles, eq(profiles.id, stories.userId))
    .where(and(eq(stories.barId, barId), gte(stories.expiresAt, now)))
    .orderBy(stories.createdAt);

  // Group by user
  const byUser = new Map<
    string,
    {
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      stories: { id: string; createdAt: Date; viewedByMe: boolean }[];
      latestCreatedAt: Date;
    }
  >();

  for (const r of rows) {
    const entry = byUser.get(r.userId);
    if (entry) {
      entry.stories.push({
        id: r.id,
        createdAt: r.createdAt,
        viewedByMe: r.viewedByMe,
      });
      if (r.createdAt > entry.latestCreatedAt) {
        entry.latestCreatedAt = r.createdAt;
      }
    } else {
      byUser.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        stories: [
          { id: r.id, createdAt: r.createdAt, viewedByMe: r.viewedByMe },
        ],
        latestCreatedAt: r.createdAt,
      });
    }
  }

  // Sort users by latest story (desc), build final shape
  const items = Array.from(byUser.values())
    .sort((a, b) => b.latestCreatedAt.getTime() - a.latestCreatedAt.getTime())
    .map<StoryBarItem>((u) => ({
      userId: u.userId,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      storyCount: u.stories.length,
      firstStoryId: u.stories[0].id, // sudah ASC saat query
      allViewed:
        u.userId === viewerId || u.stories.every((s) => s.viewedByMe),
    }));

  return items;
}

/**
 * Detail story untuk viewer modal — list semua story user ini yang aktif,
 * urut created_at ASC (story lama di-tampil pertama, kayak IG).
 */
export interface StoryDetail {
  id: string;
  imageUrl: string;
  caption: string | null;
  createdAt: Date;
  expiresAt: Date;
  table_label: string | null;
  area_name: string | null;
  viewedByMe: boolean;
}

export async function getStoriesForUser(
  userId: string,
  barId: string,
  viewerId: string
): Promise<StoryDetail[]> {
  const now = new Date();

  const rows = await db
    .select({
      id: stories.id,
      imageUrl: stories.imageUrl,
      caption: stories.caption,
      createdAt: stories.createdAt,
      expiresAt: stories.expiresAt,
      table_label: tables.label,
      area_name: floorAreas.name,
      viewedByMe: sql<boolean>`EXISTS (
        SELECT 1 FROM ${storyViews} sv
        WHERE sv.story_id = ${stories.id} AND sv.viewer_id = ${viewerId}
      )`,
    })
    .from(stories)
    .leftJoin(tableSessions, eq(tableSessions.id, stories.tableSessionId))
    .leftJoin(tables, eq(tables.id, tableSessions.tableId))
    .leftJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(stories.userId, userId),
        eq(stories.barId, barId),
        gte(stories.expiresAt, now)
      )
    )
    .orderBy(stories.createdAt);

  return rows;
}

/**
 * List viewer untuk story tertentu (cuma owner yg boleh lihat).
 */
export interface StoryViewer {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  viewedAt: Date;
}

/**
 * Latest stories untuk grid feed di landing — flat list, latest first.
 * Tidak group by user (beda dengan getActiveStoriesByBar yg untuk story bar).
 *
 * Limit untuk feed (default 12). Public — no auth check, semua aktif story
 * di bar boleh dilihat (sudah dibatasi via expires_at).
 */
export interface FeedStoryItem {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  imageUrl: string;
  caption: string | null;
  createdAt: Date;
  table_label: string | null;
  area_name: string | null;
}

export async function getLatestStoriesByBar(
  barId: string,
  limit = 12
): Promise<FeedStoryItem[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: stories.id,
      userId: stories.userId,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      imageUrl: stories.imageUrl,
      caption: stories.caption,
      createdAt: stories.createdAt,
      table_label: tables.label,
      area_name: floorAreas.name,
    })
    .from(stories)
    .innerJoin(profiles, eq(profiles.id, stories.userId))
    .leftJoin(tableSessions, eq(tableSessions.id, stories.tableSessionId))
    .leftJoin(tables, eq(tables.id, tableSessions.tableId))
    .leftJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(and(eq(stories.barId, barId), gte(stories.expiresAt, now)))
    .orderBy(desc(stories.createdAt))
    .limit(limit);
  return rows;
}

export async function getStoryViewers(storyId: string): Promise<StoryViewer[]> {
  const profile = await requireProfile();

  // Owner check
  const [story] = await db
    .select({ userId: stories.userId })
    .from(stories)
    .where(eq(stories.id, storyId));
  if (!story) throw new Error("Story tidak ditemukan");
  if (story.userId !== profile.id) {
    throw new Error("Hanya owner yang bisa lihat viewers");
  }

  const rows = await db
    .select({
      profileId: profiles.id,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      viewedAt: storyViews.viewedAt,
    })
    .from(storyViews)
    .innerJoin(profiles, eq(profiles.id, storyViews.viewerId))
    .where(eq(storyViews.storyId, storyId))
    .orderBy(desc(storyViews.viewedAt));

  return rows;
}
