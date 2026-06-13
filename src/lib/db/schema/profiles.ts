import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

/**
 * Profile = extra data per user (display name, avatar, hobbies, dll).
 * One-to-one dengan users.
 *
 * id = same as users.id (FK + PK)
 *
 * Guest profile: profile placeholder untuk walk-in customer (waiter buka meja
 * atas nama tamu). is_guest=true. users row tetap ada (fake email), tapi
 * tidak bisa login (passwordHash NULL).
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    phone: text("phone"),
    birthDate: date("birth_date"),
    bio: text("bio"),
    hobbies: text("hobbies").array().notNull().default([]),
    isGuest: boolean("is_guest").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("idx_profiles_hobbies").using("gin", t.hobbies)]
);

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.id], references: [users.id] }),
}));

