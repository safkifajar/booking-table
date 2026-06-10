import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tableSessions, sessionMembers } from "./sessions";
import { menuItems } from "./menu";
import {
  orderStatusEnum,
  orderItemStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  splitModeEnum,
} from "./_enums";

/**
 * Order = bill/tab untuk session. Biasanya 1 session = 1 order yang terus ditambah.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { mode: "date" }),
  },
  (t) => [
    uniqueIndex("uq_open_order_per_session")
      .on(t.sessionId)
      .where(sql`status <> 'closed'`),
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
    quantity: integer("quantity").notNull().default(1),
    unitPrice: integer("unit_price").notNull(),
    notes: text("notes"),
    status: orderItemStatusEnum("status").notNull().default("draft"),
    queueNumber: integer("queue_number"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    servedAt: timestamp("served_at", { mode: "date" }),
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
    paidAt: timestamp("paid_at", { mode: "date" }),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("ck_payments_amount_positive", sql`${t.amount} > 0`),
    index("idx_payments_order").on(t.orderId),
    index("idx_payments_member").on(t.paidByMemberId),
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

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
  addedBy: one(sessionMembers, {
    fields: [orderItems.addedByMemberId],
    references: [sessionMembers.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  paidBy: one(sessionMembers, {
    fields: [payments.paidByMemberId],
    references: [sessionMembers.id],
  }),
}));

