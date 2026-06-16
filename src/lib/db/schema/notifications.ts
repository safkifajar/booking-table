import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { profiles } from "./profiles";
import { notificationTypeEnum } from "./_enums";

/**
 * Notifikasi in-app per user. Dipush realtime via Postgres NOTIFY ke channel
 * "user:<profileId>" (lihat lib/realtime/channels.ts → channels.user).
 *
 * - type: jenis notif (table_joined, table_invite, dst)
 * - link: tujuan saat notif diklik (mis. /session/<id>)
 * - read_at: NULL = belum dibaca (badge unread)
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull().default("general"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { mode: "date" }),
    // Saat notif undangan (table_invite) direspon (terima/tolak). NULL = belum
    // → tombol Terima/Tolak masih muncul di bell.
    respondedAt: timestamp("responded_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_notifications_profile").on(t.profileId, t.createdAt),
  ]
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  profile: one(profiles, {
    fields: [notifications.profileId],
    references: [profiles.id],
  }),
}));
