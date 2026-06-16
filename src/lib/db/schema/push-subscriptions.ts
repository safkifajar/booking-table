import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { profiles } from "./profiles";

/**
 * Web Push subscription per device/browser. Dipakai untuk kirim notif popup
 * OS (walau web ditutup) via lib web-push + VAPID.
 *
 * - endpoint: unik per device (upsert by endpoint).
 * - p256dh + auth: kunci enkripsi dari browser PushSubscription.getKey().
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("idx_push_subscriptions_profile").on(t.profileId)]
);

export const pushSubscriptionsRelations = relations(
  pushSubscriptions,
  ({ one }) => ({
    profile: one(profiles, {
      fields: [pushSubscriptions.profileId],
      references: [profiles.id],
    }),
  })
);
