import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { profiles } from "./profiles";

/**
 * Pengajuan hapus akun oleh customer (butuh persetujuan admin). Approve =
 * SOFT DELETE: profiles.is_active di-set false (akun tak bisa login). Data
 * transaksi/tagihan tetap utuh — tak pernah hard-delete.
 *
 * Status: pending → approved | rejected. (cancelled disediakan bila nanti user
 * boleh membatalkan pengajuannya sendiri.)
 *
 * status text (bukan enum) mengikuti pola table_move_requests — hindari
 * ALTER TYPE saat menambah nilai baru.
 */
export const accountDeletionRequests = pgTable(
  "account_deletion_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** Alasan pengajuan (wajib diisi customer). */
    reason: text("reason").notNull(),
    /** 'pending' | 'approved' | 'rejected' | 'cancelled'. */
    status: text("status").notNull().default("pending"),
    /** Admin yg approve/reject. */
    resolvedBy: uuid("resolved_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_acct_del_req_requested_by").on(t.requestedBy),
    index("idx_acct_del_req_status").on(t.status),
  ]
);

export const accountDeletionRequestsRelations = relations(
  accountDeletionRequests,
  ({ one }) => ({
    requester: one(profiles, {
      fields: [accountDeletionRequests.requestedBy],
      references: [profiles.id],
    }),
    resolver: one(profiles, {
      fields: [accountDeletionRequests.resolvedBy],
      references: [profiles.id],
    }),
  })
);
