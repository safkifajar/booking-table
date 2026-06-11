import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Auth.js v5 standard tables (next-auth schema).
 * https://authjs.dev/getting-started/adapters/drizzle
 *
 * - users: identitas user (replace auth.users dari Supabase)
 * - accounts: OAuth provider account (Google, GitHub, dll). Untuk credentials (email+password) tidak butuh row di sini.
 * - sessions: active sessions (kalau pakai database session strategy)
 * - verification_tokens: untuk magic link email verification + password reset
 *
 * Note: profiles table di-link ke users.id (one-to-one).
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Auth.js expects these standard columns (name, email, image)
  // Tapi business display_name & avatar_url tetap kita simpan di profiles
  // untuk decoupling Auth dari domain. name/image di sini opsional.
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // password_hash untuk credential provider (bcrypt). Kalau OAuth only, nullable.
  passwordHash: text("password_hash"),
  // Audit fields
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'oauth' | 'email' | 'credentials'
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

/**
 * Relations untuk query builder typed.
 */
export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

