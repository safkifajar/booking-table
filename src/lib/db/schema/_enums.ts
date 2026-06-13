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

export const orderStatusEnum = pgEnum("order_status", [
  "open",
  "submitted",
  "preparing",
  "served",
  "closed",
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

