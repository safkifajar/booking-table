import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  check,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { bars } from "./venue";
import { profiles } from "./profiles";
import { tableSessions } from "./sessions";
import { staffRoleEnum } from "./_enums";

/**
 * Staff role = role per-bar per-user. Satu user bisa staff di beberapa bar
 * (multi-tenant friendly).
 */
export const staffRoles = pgTable(
  "staff_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: staffRoleEnum("role").notNull().default("waiter"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("uq_staff_roles_bar_profile_role").on(t.barId, t.profileId, t.role)]
);

/**
 * Member rating = rating antar member setelah session ditutup.
 * Stars 1-5 + array tag positif.
 */
export const memberRatings = pgTable(
  "member_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id, { onDelete: "cascade" }),
    raterId: uuid("rater_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    rateeId: uuid("ratee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(),
    tags: text("tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("ck_member_ratings_stars_range", sql`${t.stars} between 1 and 5`),
    check("ck_member_ratings_no_self", sql`${t.raterId} <> ${t.rateeId}`),
    unique("uq_member_ratings_session_rater_ratee").on(
      t.sessionId,
      t.raterId,
      t.rateeId
    ),
    index("idx_ratings_ratee").on(t.rateeId),
    index("idx_ratings_session").on(t.sessionId),
  ]
);

/**
 * Relations
 */
export const staffRolesRelations = relations(staffRoles, ({ one }) => ({
  bar: one(bars, { fields: [staffRoles.barId], references: [bars.id] }),
  profile: one(profiles, {
    fields: [staffRoles.profileId],
    references: [profiles.id],
  }),
}));

export const memberRatingsRelations = relations(memberRatings, ({ one }) => ({
  session: one(tableSessions, {
    fields: [memberRatings.sessionId],
    references: [tableSessions.id],
  }),
  rater: one(profiles, {
    fields: [memberRatings.raterId],
    references: [profiles.id],
  }),
  ratee: one(profiles, {
    fields: [memberRatings.rateeId],
    references: [profiles.id],
  }),
}));

