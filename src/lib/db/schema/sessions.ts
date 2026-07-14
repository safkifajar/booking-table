import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tables } from "./venue";
import { profiles } from "./profiles";
import {
  sessionStatusEnum,
  sessionVisibilityEnum,
  memberRoleEnum,
  memberStatusEnum,
} from "./_enums";

/**
 * Table session = instance "open table" yang dibuat oleh host.
 * Lifecycle: open → (optional locked) → closed / cancelled.
 */
export const tableSessions = pgTable(
  "table_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "restrict" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    status: sessionStatusEnum("status").notNull().default("open"),
    visibility: sessionVisibilityEnum("visibility").notNull().default("public"),
    title: text("title"),
    vibeTags: text("vibe_tags").array().notNull().default([]),
    maxGuests: integer("max_guests"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    notes: text("notes"),
    /**
     * Staff yang buka meja ini (untuk walk-in customer tanpa HP).
     * NULL = customer self-service (buka via scan QR).
     * Set = waiter/cashier/manager yang buka atas nama tamu.
     */
    openedByStaffId: uuid("opened_by_staff_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /**
     * List nama tamu yang duduk di meja (untuk walk-in).
     * Free-text array. Max length sesuai table.capacity (enforce di app).
     */
    guestNames: text("guest_names").array().notNull().default([]),
    /**
     * Reservation: kapan booking dimulai. NULL = walk-in immediate.
     * Set + status='reserved' = future booking. Set + status='open' = aktif.
     */
    reservationAt: timestamp("reservation_at", { withTimezone: true, mode: "date" }),
    /**
     * Reservation: kapan booking berakhir. NULL = walk-in. Set bersama
     * reservationAt untuk rentang waktu (mis. 14:00–17:00).
     */
    reservationEndAt: timestamp("reservation_end_at", { withTimezone: true, mode: "date" }),
    /**
     * Timestamp DP terverify. NULL = no DP required atau belum bayar.
     */
    dpPaidAt: timestamp("dp_paid_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Hanya 1 session AKTIF (open/locked) per table. Reservasi (reserved) boleh
    // banyak di slot berbeda — overlap dicegah di aplikasi (openTable).
    // 'overdue' (lewat waktu, nunggak bayar) TIDAK dihitung okupansi fisik —
    // orang sudah pergi, meja bisa dipakai tamu baru sambil hutang tetap tertagih.
    uniqueIndex("uq_active_session_per_table")
      .on(t.tableId)
      .where(sql`status in ('open', 'locked')`),
    index("idx_sessions_visibility").on(t.visibility, t.status),
    index("idx_sessions_host").on(t.hostId),
    // Filter upcoming reservations efficient
    index("idx_sessions_reservation_at")
      .on(t.reservationAt)
      .where(sql`reservation_at is not null`),
    // Overlap query: reservasi 'reserved' per meja by rentang waktu
    index("idx_sessions_reserved_range")
      .on(t.tableId, t.reservationAt, t.reservationEndAt)
      .where(sql`status = 'reserved'`),
  ]
);

/**
 * Member = profile yang join session.
 * Status: pending (request join), joined (active), left, kicked.
 */
export const sessionMembers = pgTable(
  "session_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    status: memberStatusEnum("status").notNull().default("joined"),
    /**
     * Host yg mengundang (invite_only). Terisi = undangan (user yg approve).
     * NULL + status pending = request-join biasa (host yg approve).
     */
    invitedBy: uuid("invited_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("uq_session_members_session_profile").on(t.sessionId, t.profileId),
    index("idx_members_session").on(t.sessionId),
    index("idx_members_profile").on(t.profileId),
  ]
);

/**
 * Relations
 */
export const tableSessionsRelations = relations(tableSessions, ({ one, many }) => ({
  table: one(tables, { fields: [tableSessions.tableId], references: [tables.id] }),
  host: one(profiles, { fields: [tableSessions.hostId], references: [profiles.id] }),
  members: many(sessionMembers),
}));

export const sessionMembersRelations = relations(sessionMembers, ({ one }) => ({
  session: one(tableSessions, {
    fields: [sessionMembers.sessionId],
    references: [tableSessions.id],
  }),
  profile: one(profiles, {
    fields: [sessionMembers.profileId],
    references: [profiles.id],
  }),
}));

