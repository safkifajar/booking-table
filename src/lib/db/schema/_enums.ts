import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enums dari migration 0001_schema.sql.
 * Diport satu-per-satu untuk preserve nama type di DB.
 */

export const sessionStatusEnum = pgEnum("session_status", [
  "reserved",
  "open",
  "locked",
  "closed",
  "cancelled",
  // Reservasi/sesi yang waktunya sudah lewat TAPI masih ada tagihan belum
  // lunas. Diperlakukan seperti aktif (tetap di kasir, meja terisi) sampai
  // dilunasi → baru jadi 'closed'. Ditambah via migration 0026.
  "overdue",
]);

export const sessionVisibilityEnum = pgEnum("session_visibility", [
  "public",
  "friends",
  "invite_only",
]);

export const memberRoleEnum = pgEnum("member_role", ["host", "member", "guest"]);

export const memberStatusEnum = pgEnum("member_status", [
  "pending",
  "joined",
  "left",
  "kicked",
]);

export const tableShapeEnum = pgEnum("table_shape", [
  "round",
  "square",
  "rect",
  "booth",
]);

// Urutan mengikuti urutan fisik di Postgres: 4 nilai awal dari migration 0023,
// lalu 'invite_rejected' ditambah di akhir via ALTER TYPE (migration 0025).
export const notificationTypeEnum = pgEnum("notification_type", [
  "table_joined", // auto-join (friends) — kamu sudah digabung ke meja
  "table_invite", // invite_only — kamu diundang, perlu terima
  "invite_accepted", // pengundang: undangan diterima
  "general",
  "invite_rejected", // pengundang: undangan ditolak
  "invite_cancelled", // penerima: undangan dibatalkan host (migration 0027)
  "move_request", // staff: ada request pindah meja (migration 0042)
  "move_approved", // host: request pindah di-approve
  "move_rejected", // host: request pindah ditolak
  "payment_received", // pembayaran QRIS lunas / DP booking dikonfirmasi (0054)
  "payment_cancelled", // pembayaran gagal / kadaluarsa (0054)
]);

// Multi-order lifecycle (PRD Multi-Order Prepaid): unpaid → paid → closed.
// Nilai lama (open/submitted/preparing/served) dipertahankan utk kompat data
// existing & backfill; kode baru hanya memakai unpaid/paid/closed.
// "cancelled": order unpaid yg dibatalkan customer (back dari halaman bayar) —
// order + pembayaran pending dibatalkan, order tak masuk dapur/kasir/tagihan.
export const orderStatusEnum = pgEnum("order_status", [
  "open",
  "submitted",
  "preparing",
  "served",
  "closed",
  "unpaid",
  "paid",
  "cancelled",
]);

export const orderItemStatusEnum = pgEnum("order_item_status", [
  "draft",
  "sent",
  "preparing",
  "served",
  "void",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "qris",
  "cash",
  "card",
  "gopay",
  "ovo",
  "mock",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
]);

export const splitModeEnum = pgEnum("split_mode", [
  "equal",
  "itemized",
  "custom",
]);

export const staffRoleEnum = pgEnum("staff_role", [
  "waiter",
  "cashier",
  "manager",
  "admin",
]);

