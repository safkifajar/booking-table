import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tableSessions } from "./sessions";
import { tables } from "./venue";
import { profiles } from "./profiles";

/**
 * Request pindah meja saat sesi AKTIF (butuh approval staff). Fase 2.
 * Status: pending → approved | rejected | cancelled.
 *
 * Saat approved, eksekusi pindah (ubah table_id + waktu) dijalankan, dan baris
 * ini jadi catatan riwayat (from_table → to_table).
 */
export const tableMoveRequests = pgTable(
  "table_move_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    fromTableId: uuid("from_table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "restrict" }),
    toTableId: uuid("to_table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "restrict" }),
    /** ISO jam mulai baru yg diminta (durasi dikunci di app). */
    reservationAt: timestamp("reservation_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    reservationEndAt: timestamp("reservation_end_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    /** 'pending' | 'approved' | 'rejected' | 'cancelled'. */
    status: text("status").notNull().default("pending"),
    /** Staff yg approve/reject. */
    resolvedBy: uuid("resolved_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_move_req_session").on(t.sessionId),
    index("idx_move_req_status").on(t.status),
  ]
);
