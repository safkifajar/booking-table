import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { bars } from "./venue";
import { tableSessions } from "./sessions";

/** Jenis story: 'image' = foto (default lama), 'text' = teks di atas warna. */
export const storyKindEnum = pgEnum("story_kind", ["image", "text"]);

/** Gaya tipografi untuk story teks (mirip "Aa" WhatsApp). */
export const storyTextStyleEnum = pgEnum("story_text_style", [
  "classic",
  "serif",
  "mono",
  "strong",
]);

/**
 * Story = foto sharing per user, expire 24 jam.
 *
 * - barId: scope per bar (single-bar deployment selalu sama, tapi multi-bar
 *   nanti supaya story tidak bocor cross-bar)
 * - tableSessionId: nullable, auto-tag kalau user upload saat lagi di
 *   session aktif. Hilang saat session closed (FK ON DELETE SET NULL).
 * - expiresAt: dihitung server-side saat insert (createdAt + 24h).
 *   Cron periodic delete row + file dari storage (lihat /api/cron/expire-stories).
 *
 * Index: (barId, expiresAt) untuk query "story aktif di bar X" cepat.
 */
export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    tableSessionId: uuid("table_session_id").references(
      () => tableSessions.id,
      { onDelete: "set null" }
    ),
    /** Jenis story. 'image' = pakai imageUrl; 'text' = pakai caption + bgColor. */
    kind: storyKindEnum("kind").notNull().default("image"),
    /** Nullable: story teks tak punya gambar. Wajib untuk kind='image'. */
    imageUrl: text("image_url"),
    /** Warna latar story teks (hex). Null untuk story foto. */
    bgColor: text("bg_color"),
    /** Gaya tipografi story teks. Null/'classic' = default. */
    textStyle: storyTextStyleEnum("text_style").notNull().default("classic"),
    /** Profil (teman) yang di-tag via @username di caption/teks. */
    mentions: uuid("mentions").array().notNull().default([]),
    /**
     * Repost: kalau story ini hasil "add to your story" dari mention, ini =
     * profileId pembuat ASLI (untuk render kartu embed "via @pembuat"). Null =
     * story original. FK set null kalau pembuat asli terhapus.
     */
    repostOfAuthorId: uuid("repost_of_author_id").references(
      () => profiles.id,
      { onDelete: "set null" }
    ),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (t) => [
    check("ck_stories_caption_length", sql`char_length(${t.caption}) <= 280`),
    // Konsistensi tipe: foto wajib punya imageUrl; teks wajib punya caption.
    check(
      "ck_stories_kind_payload",
      sql`(${t.kind} = 'image' AND ${t.imageUrl} IS NOT NULL) OR (${t.kind} = 'text' AND ${t.caption} IS NOT NULL)`
    ),
    index("idx_stories_bar_expires").on(t.barId, t.expiresAt),
    index("idx_stories_user").on(t.userId),
  ]
);

/**
 * View tracking — siapa yang sudah lihat story.
 * Composite PK (story_id, viewer_id) supaya 1 viewer = 1 row per story
 * (idempotent insert via onConflictDoNothing).
 *
 * Story owner query: ambil semua viewer untuk story-nya, order by viewed_at.
 */
export const storyViews = pgTable(
  "story_views",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storyId, t.viewerId] }),
    index("idx_story_views_story").on(t.storyId, t.viewedAt),
  ]
);

export const storiesRelations = relations(stories, ({ one, many }) => ({
  user: one(profiles, { fields: [stories.userId], references: [profiles.id] }),
  bar: one(bars, { fields: [stories.barId], references: [bars.id] }),
  session: one(tableSessions, {
    fields: [stories.tableSessionId],
    references: [tableSessions.id],
  }),
  views: many(storyViews),
}));

export const storyViewsRelations = relations(storyViews, ({ one }) => ({
  story: one(stories, {
    fields: [storyViews.storyId],
    references: [stories.id],
  }),
  viewer: one(profiles, {
    fields: [storyViews.viewerId],
    references: [profiles.id],
  }),
}));
