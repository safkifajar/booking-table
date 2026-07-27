"use server";

/**
 * Server Actions untuk Story feature.
 *
 * Dipisah dari actions.ts (yang sudah 900+ baris) supaya gampang maintain.
 */

import { revalidatePath } from "next/cache";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { stories, storyViews } from "@/lib/db/schema/stories";
import { profiles } from "@/lib/db/schema/profiles";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { requireProfile } from "@/lib/auth-v2/current";
import {
  getBlockedIdSet,
  getFriendIdSet,
  isBlockedEitherWay,
} from "@/lib/friends";
import {
  areFriends,
} from "@/lib/friends";
import {
  getEffectiveRankMap,
  getEffectiveRankOf,
  MEMBERSHIP_RANK,
} from "@/lib/membership";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import { createNotification } from "@/lib/notifications";
import { STORY_TEXT_BG_COLORS, STORY_TEXT_STYLES } from "@/lib/story-constants";

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

const captionSchema = z.string().max(280, "Max 280 characters").optional();
const barIdSchema = z.string().uuid();

/**
 * Cari session aktif yang sedang di-join user di bar tsb (untuk auto-tag).
 * Dipakai bersama oleh createStory & createTextStory.
 */
async function findActiveSessionId(
  profileId: string,
  barId: string
): Promise<string | null> {
  const [row] = await db
    .select({ session_id: tableSessions.id })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(sessionMembers.profileId, profileId),
        eq(sessionMembers.status, "joined"),
        eq(floorAreas.barId, barId),
        sql`${tableSessions.status} IN ('open', 'locked', 'overdue')`
      )
    )
    .orderBy(desc(sessionMembers.joinedAt))
    .limit(1);
  return row?.session_id ?? null;
}

/** Ambil @username unik dari teks. Handle: 3-20 char [a-z0-9_], lowercase. */
function parseMentionHandles(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /@([a-z0-9_]{3,20})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1].toLowerCase());
  return Array.from(out).slice(0, 20); // batas wajar
}

/**
 * Resolve @username di teks → profil TEMAN (bukan diri, bukan blokir), lalu
 * kirim notifikasi "menyebut kamu di story" ke tiap orang yg di-tag.
 * Mengembalikan daftar profileId yang berhasil di-tag (untuk disimpan di row).
 */
async function resolveMentionsAndNotify(args: {
  authorId: string;
  authorName: string;
  text: string | null | undefined;
  storyId: string;
}): Promise<string[]> {
  const handles = parseMentionHandles(args.text);
  if (handles.length === 0) return [];

  // Resolve handle → profil.
  const people = await db
    .select({ id: profiles.id, username: profiles.username })
    .from(profiles)
    .where(inArray(profiles.username, handles));
  if (people.length === 0) return [];

  // Hanya TEMAN (exclude diri sendiri otomatis: diri bukan teman-dirinya).
  const friendIds = await getFriendIdSet(args.authorId);
  const taggedIds = people
    .filter((p) => p.id !== args.authorId && friendIds.has(p.id))
    .map((p) => p.id);
  if (taggedIds.length === 0) return [];

  // Kirim notifikasi (in-app + push otomatis) ke tiap yang di-tag.
  await Promise.allSettled(
    taggedIds.map((pid) =>
      createNotification({
        profileId: pid,
        type: "story_mention",
        title: `${args.authorName} mentioned you in a story`,
        body: "Tap to view their profile.",
        link: `/network/${args.authorId}`,
        refId: args.storyId,
      })
    )
  );

  return taggedIds;
}

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

  if (!(file instanceof File)) throw new Error("Invalid file");
  if (file.size === 0) throw new Error("File is empty");
  if (file.size > MAX_STORY_BYTES) {
    throw new Error(
      `File is too large (max ${Math.floor(MAX_STORY_BYTES / 1024 / 1024)}MB)`
    );
  }

  const heic = isHeicFile(file);
  const validMime = ACCEPTED_STORY_TYPES.includes(
    file.type as (typeof ACCEPTED_STORY_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("File must be JPG, PNG, WebP, or HEIC");
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
  const activeSessionId = await findActiveSessionId(profile.id, barId);

  // Insert story row (id dipakai sebagai storage key — unique + immutable)
  const [newStory] = await db
    .insert(stories)
    .values({
      userId: profile.id,
      barId,
      tableSessionId: activeSessionId,
      kind: "image",
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

  // Mention @username di caption → notif ke teman yg di-tag.
  const mentions = await resolveMentionsAndNotify({
    authorId: profile.id,
    authorName: profile.displayName,
    text: caption,
    storyId: newStory.id,
  });

  // Update row dengan URL final (+ mentions).
  await db
    .update(stories)
    .set({ imageUrl: publicUrl, mentions })
    .where(eq(stories.id, newStory.id));

  // Notify bar channel supaya semua viewer di bar dapat update realtime
  await notify(channels.bar(barId), { type: "story.new", storyId: newStory.id });

  revalidatePath("/", "layout");

  return { id: newStory.id };
}

/**
 * Buat story TEKS (tanpa foto): latar warna + teks di tengah.
 * Skip pipeline sharp/upload — langsung insert row.
 *
 * Field:
 * - barId: uuid bar
 * - text: isi story (1..280 char, WAJIB)
 * - bgColor: hex warna latar (harus salah satu STORY_TEXT_BG_COLORS)
 */
const createTextStorySchema = z.object({
  barId: barIdSchema,
  text: z.string().trim().min(1, "Write something").max(280, "Max 280 characters"),
  bgColor: z.enum(STORY_TEXT_BG_COLORS),
  textStyle: z.enum(STORY_TEXT_STYLES as [string, ...string[]]).default("classic"),
});

export async function createTextStory(input: {
  barId: string;
  text: string;
  bgColor: string;
  textStyle?: string;
}): Promise<{ id: string }> {
  const profile = await requireProfile();
  const { barId, text, bgColor, textStyle } = createTextStorySchema.parse(input);

  const activeSessionId = await findActiveSessionId(profile.id, barId);

  const [newStory] = await db
    .insert(stories)
    .values({
      userId: profile.id,
      barId,
      tableSessionId: activeSessionId,
      kind: "text",
      imageUrl: null,
      bgColor,
      textStyle: textStyle as "classic" | "serif" | "mono" | "strong",
      caption: text,
    })
    .returning({ id: stories.id });

  // Mention @username di teks → notif ke teman yg di-tag + simpan di row.
  const mentions = await resolveMentionsAndNotify({
    authorId: profile.id,
    authorName: profile.displayName,
    text,
    storyId: newStory.id,
  });
  if (mentions.length > 0) {
    await db
      .update(stories)
      .set({ mentions })
      .where(eq(stories.id, newStory.id));
  }

  await notify(channels.bar(barId), { type: "story.new", storyId: newStory.id });
  revalidatePath("/", "layout");

  return { id: newStory.id };
}

/**
 * Daftar teman yang bisa di-mention (@) — hanya yang PUNYA username.
 * Dipakai autocomplete di composer. Menyaring yg saling blokir.
 */
export interface MentionCandidate {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

export async function getMentionableFriends(): Promise<MentionCandidate[]> {
  const profile = await requireProfile();
  const { getFriendsListOf } = await import("@/lib/friends");
  const blocked = await getBlockedIdSet(profile.id);
  const friends = await getFriendsListOf(profile.id, { excludeIds: blocked });
  return friends
    .filter((f) => !!f.username)
    .map((f) => ({
      id: f.id,
      displayName: f.display_name,
      username: f.username as string,
      avatarUrl: f.avatar_url,
    }));
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

  if (!story) throw new Error("Story not found");
  if (story.userId !== profile.id) {
    throw new Error("Only the owner can delete this");
  }

  // Hapus file dulu (best-effort), lalu row. Story teks tak punya file.
  if (story.imageUrl) await storage.delete(story.imageUrl);
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

  // Saring yg saling blokir (PRD K6b) + KUNCI LEVEL (PRD Membership G3:
  // story dari user dgn rank <= rank viewer; self & TEMAN selalu tampil) +
  // urutan: milik sendiri → TEMAN → lainnya (PRD K4), story terbaru di
  // depan dalam tiap kelompok. Story terkunci TIDAK dikirim ke client.
  const [blockedIds, friendIds, viewerRank, rankMap] = await Promise.all([
    getBlockedIdSet(viewerId),
    getFriendIdSet(viewerId),
    getEffectiveRankOf(viewerId),
    getEffectiveRankMap(Array.from(byUser.keys())),
  ]);
  const rank = (userId: string) =>
    userId === viewerId ? 0 : friendIds.has(userId) ? 1 : 2;
  const items = Array.from(byUser.values())
    .filter((u) => !blockedIds.has(u.userId))
    .filter(
      (u) =>
        u.userId === viewerId ||
        friendIds.has(u.userId) ||
        (rankMap.get(u.userId) ?? MEMBERSHIP_RANK.basic) <= viewerRank
    )
    .sort(
      (a, b) =>
        rank(a.userId) - rank(b.userId) ||
        b.latestCreatedAt.getTime() - a.latestCreatedAt.getTime()
    )
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
export interface MentionedUser {
  id: string;
  username: string;
}

export interface StoryDetail {
  id: string;
  kind: "image" | "text";
  imageUrl: string | null;
  bgColor: string | null;
  textStyle: "classic" | "serif" | "mono" | "strong";
  caption: string | null;
  /** Profil (id + username) yang di-tag — untuk highlight @handle klik-ke-profil. */
  mentionedUsers: MentionedUser[];
  createdAt: Date;
  expiresAt: Date;
  table_label: string | null;
  area_name: string | null;
  viewedByMe: boolean;
  viewCount: number;
}

export async function getStoriesForUser(
  userId: string,
  barId: string,
  viewerId: string
): Promise<StoryDetail[]> {
  // Saling blokir → seolah tak ada story (PRD K6b, disguised).
  if (viewerId !== userId && (await isBlockedEitherWay(viewerId, userId))) {
    return [];
  }
  // Kunci level (PRD Membership G3): pemilik rank lebih tinggi & bukan
  // teman → kosong (guard lapis server; story bar sudah menyaring).
  if (viewerId !== userId) {
    const [viewerRank, ownerRankMap, friend] = await Promise.all([
      getEffectiveRankOf(viewerId),
      getEffectiveRankMap([userId]),
      areFriends(viewerId, userId),
    ]);
    const ownerRank = ownerRankMap.get(userId) ?? MEMBERSHIP_RANK.basic;
    if (!friend && ownerRank > viewerRank) return [];
  }
  const now = new Date();

  const rows = await db
    .select({
      id: stories.id,
      kind: stories.kind,
      imageUrl: stories.imageUrl,
      bgColor: stories.bgColor,
      textStyle: stories.textStyle,
      caption: stories.caption,
      mentions: stories.mentions,
      createdAt: stories.createdAt,
      expiresAt: stories.expiresAt,
      table_label: tables.label,
      area_name: floorAreas.name,
      viewedByMe: sql<boolean>`EXISTS (
        SELECT 1 FROM ${storyViews} sv
        WHERE sv.story_id = ${stories.id} AND sv.viewer_id = ${viewerId}
      )`,
      viewCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${storyViews} sv
        WHERE sv.story_id = ${stories.id}
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

  // Resolve semua mention id → username (sekali query untuk seluruh story).
  const allMentionIds = Array.from(
    new Set(rows.flatMap((r) => r.mentions ?? []))
  );
  const mentionMap = new Map<string, string>();
  if (allMentionIds.length > 0) {
    const mentioned = await db
      .select({ id: profiles.id, username: profiles.username })
      .from(profiles)
      .where(inArray(profiles.id, allMentionIds));
    for (const m of mentioned) {
      if (m.username) mentionMap.set(m.id, m.username);
    }
  }

  return rows.map((r) => {
    const { mentions, ...rest } = r;
    return {
      ...rest,
      mentionedUsers: (mentions ?? []).flatMap((id) => {
        const username = mentionMap.get(id);
        return username ? [{ id, username }] : [];
      }),
    };
  });
}

/** True kalau user punya minimal 1 story aktif (belum expired) di bar. Ringan. */
export async function hasActiveStory(
  userId: string,
  barId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: stories.id })
    .from(stories)
    .where(
      and(
        eq(stories.userId, userId),
        eq(stories.barId, barId),
        gte(stories.expiresAt, new Date())
      )
    )
    .limit(1);
  return !!row;
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
  kind: "image" | "text";
  imageUrl: string | null;
  bgColor: string | null;
  textStyle: "classic" | "serif" | "mono" | "strong";
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
      kind: stories.kind,
      imageUrl: stories.imageUrl,
      bgColor: stories.bgColor,
      textStyle: stories.textStyle,
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
  if (!story) throw new Error("Story not found");
  if (story.userId !== profile.id) {
    throw new Error("Only the owner can view viewers");
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

  // View lama dari orang yg kini saling blokir disembunyikan (PRD K6b).
  const blockedIds = await getBlockedIdSet(profile.id);
  return blockedIds.size > 0
    ? rows.filter((r) => !blockedIds.has(r.profileId))
    : rows;
}
