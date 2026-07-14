import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { friendRequestStatusEnum } from "./_enums";

/**
 * Friend request yang sedang/pernah berjalan (PRD Friends 4.1).
 *
 * SATU baris per ARAH (requester -> addressee), DIPAKAI ULANG saat kirim-ulang:
 * unique (requester, addressee) membuat INSERT kedua selalu gagal, jadi
 * kirim-ulang = ON CONFLICT DO UPDATE reset ke 'pending' (PRD 6.3). Jangan
 * pernah INSERT polos untuk kirim-ulang.
 *
 * Anti-spam (PRD 6.4): cooldown 1 hari setelah rejected (cek responded_at),
 * kuota 20 request keluar / 24 jam (cek created_at) — ditegakkan di action.
 */
export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: friendRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("uq_friend_requests_pair").on(t.requesterId, t.addresseeId),
    index("idx_friend_requests_addressee").on(t.addresseeId),
    index("idx_friend_requests_requester").on(t.requesterId),
    check("ck_friend_requests_not_self", sql`requester_id <> addressee_id`),
  ]
);

/**
 * Pertemanan yang sudah jadi (PRD Friends 4.2) — SATU baris per pasangan
 * dengan urutan kanonik user_a < user_b. Struktur ini membuat duplikat /
 * pertemanan "sebelah" MUSTAHIL secara skema.
 *
 * PENTING: JANGAN bangun query friendships di luar helper src/lib/friends.ts
 * (orderPair/areFriends/getFriendIds). Query yang lupa mengurutkan pasangan
 * akan salah membaca "bukan teman" padahal berteman.
 */
export const friendships = pgTable(
  "friendships",
  {
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId] }),
    index("idx_friendships_user_b").on(t.userBId),
    check("ck_friendships_ordered", sql`user_a_id < user_b_id`),
  ]
);

/**
 * Blokir antar user (PRD Friends 4.3). Disimpan SEARAH (siapa memblokir siapa
 * — perlu untuk halaman /profile/blocked), tapi EFEKNYA SIMETRIS: ada baris ke
 * arah mana pun = keduanya saling tak terlihat & tak bisa berinteraksi.
 *
 * A blokir B dan B blokir A = 2 baris BERBEDA. Unblock oleh A tidak menyentuh
 * blokir milik B. Semua pengecekan wajib dua arah — pakai helper
 * isBlockedEitherWay/getBlockedIdSet di src/lib/friends.ts.
 */
export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("idx_user_blocks_blocked").on(t.blockedId),
    check("ck_user_blocks_not_self", sql`blocker_id <> blocked_id`),
  ]
);

export const friendRequestsRelations = relations(friendRequests, ({ one }) => ({
  requester: one(profiles, {
    fields: [friendRequests.requesterId],
    references: [profiles.id],
  }),
  addressee: one(profiles, {
    fields: [friendRequests.addresseeId],
    references: [profiles.id],
  }),
}));

export const friendshipsRelations = relations(friendships, ({ one }) => ({
  userA: one(profiles, {
    fields: [friendships.userAId],
    references: [profiles.id],
  }),
  userB: one(profiles, {
    fields: [friendships.userBId],
    references: [profiles.id],
  }),
}));

export const userBlocksRelations = relations(userBlocks, ({ one }) => ({
  blocker: one(profiles, {
    fields: [userBlocks.blockerId],
    references: [profiles.id],
  }),
  blocked: one(profiles, {
    fields: [userBlocks.blockedId],
    references: [profiles.id],
  }),
}));
