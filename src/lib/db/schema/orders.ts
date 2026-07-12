import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tableSessions, sessionMembers } from "./sessions";
import { menuItems } from "./menu";
import { profiles } from "./profiles";
import {
  orderStatusEnum,
  orderItemStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  splitModeEnum,
} from "./_enums";

/**
 * Order = satu batch pesanan untuk session. Multi-order: satu session bisa punya
 * BANYAK order (tiap tambah pesanan = order baru), tapi maks 1 order 'unpaid'
 * sekaligus (harus lunas dulu baru bisa buat order baru).
 * Lifecycle: unpaid → paid (masuk dapur) → closed.
 * (PRD Multi-Order Prepaid.)
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull().default("unpaid"),
    /** Kapan order lunas & "masuk" ke dapur/staff. NULL = belum lunas. */
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    // Maks 1 order 'unpaid' per sesi (Q1) — harus lunas dulu baru buat order baru.
    uniqueIndex("uq_unpaid_order_per_session")
      .on(t.sessionId)
      .where(sql`status = 'unpaid'`),
    index("idx_orders_session").on(t.sessionId),
  ]
);

/**
 * Order item = setiap item pesanan, dilacak siapa yang menambahkannya.
 * unit_price di-snapshot saat order dibuat (anti perubahan harga menu).
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "restrict" }),
    addedByMemberId: uuid("added_by_member_id")
      .notNull()
      .references(() => sessionMembers.id, { onDelete: "restrict" }),
    /**
     * Staff yang input order ini atas nama customer (untuk walk-in).
     * NULL = customer add sendiri.
     * Set = staff add atas nama member (added_by_member_id = guest, input_by = waiter).
     */
    inputByStaffId: uuid("input_by_staff_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: integer("unit_price").notNull(),
    notes: text("notes"),
    status: orderItemStatusEnum("status").notNull().default("draft"),
    queueNumber: integer("queue_number"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    servedAt: timestamp("served_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    check("ck_order_items_quantity_positive", sql`${t.quantity} > 0`),
    check("ck_order_items_unit_price_non_negative", sql`${t.unitPrice} >= 0`),
    index("idx_order_items_order").on(t.orderId),
    index("idx_order_items_member").on(t.addedByMemberId),
    index("idx_order_items_queue_number")
      .on(t.queueNumber, t.createdAt)
      .where(sql`queue_number is not null`),
  ]
);

/**
 * Payment = pembayaran per anggota (split).
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    paidByMemberId: uuid("paid_by_member_id")
      .notNull()
      .references(() => sessionMembers.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    method: paymentMethodEnum("method").notNull().default("mock"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    splitMode: splitModeEnum("split_mode").notNull().default("equal"),
    splitMeta: jsonb("split_meta").default({}).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("ck_payments_amount_positive", sql`${t.amount} > 0`),
    index("idx_payments_order").on(t.orderId),
    index("idx_payments_member").on(t.paidByMemberId),
  ]
);

/**
 * Payment items = penautan satu pembayaran ke item order yang dicakupnya.
 * HANYA diisi untuk pembayaran berbasis item (split_mode='itemized' / "my
 * order"). DP / equal / custom TIDAK menulis baris di sini — pembayaran itu
 * tidak 1:1 ke item tertentu; di riwayat ditampilkan label + nominal saja.
 * Lihat PRD Order Control §7.1.
 */
export const paymentItems = pgTable(
  "payment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    // Restrict: item yang sudah tertaut pembayaran tak boleh terhapus keras.
    // Void = ubah order_items.status='void', baris ini tetap ada (histori jujur).
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("ck_payment_items_amount_positive", sql`${t.amount} > 0`),
    unique("uq_payment_items_payment_order_item").on(t.paymentId, t.orderItemId),
    index("idx_payment_items_payment").on(t.paymentId),
    index("idx_payment_items_order_item").on(t.orderItemId),
  ]
);

/**
 * Relations
 */
export const ordersRelations = relations(orders, ({ one, many }) => ({
  session: one(tableSessions, {
    fields: [orders.sessionId],
    references: [tableSessions.id],
  }),
  items: many(orderItems),
  payments: many(payments),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
  addedBy: one(sessionMembers, {
    fields: [orderItems.addedByMemberId],
    references: [sessionMembers.id],
  }),
  paymentItems: many(paymentItems),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  paidBy: one(sessionMembers, {
    fields: [payments.paidByMemberId],
    references: [sessionMembers.id],
  }),
  items: many(paymentItems),
}));

export const paymentItemsRelations = relations(paymentItems, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentItems.paymentId],
    references: [payments.id],
  }),
  orderItem: one(orderItems, {
    fields: [paymentItems.orderItemId],
    references: [orderItems.id],
  }),
}));

