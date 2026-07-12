"use server";

/**
 * Server Actions untuk Cashier dashboard.
 *
 * Operations:
 * - getActiveSessionsForCashier: list meja aktif dengan bill summary
 * - getSessionDetailForCashier: detail bill + payments + member untuk satu meja
 * - createPayment: insert payment row + call payment gateway + return charge info
 * - markPaymentPaid: manual mark paid (untuk methods non-gateway atau kalau
 *   gateway return pending tapi cashier konfirmasi customer sudah bayar)
 * - getShiftReport: list transaksi yang cashier ini close hari ini
 *
 * Semua action butuh permission "receive_payment" (cashier/manager/admin).
 */

import { revalidatePath } from "next/cache";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { orders, orderItems, payments, paymentItems } from "@/lib/db/schema/orders";
import { menuItems } from "@/lib/db/schema/menu";
import { requirePermission } from "@/lib/auth-v2/permissions";
import { getPaymentGateway } from "@/lib/payments/gateway";
import { notifyAll } from "@/lib/realtime/notify";
import { settleOverdueIfPaid } from "@/lib/queries";
import { notifyPaymentEvent } from "@/lib/payment-notify";
import { getChargeConfig } from "@/lib/settings-actions";
import { computeBillTotals } from "@/lib/settings-constants";
import type { PaymentMethod, SplitMode } from "@/types/db";

// ============================================================
// LIST ACTIVE SESSIONS (for cashier landing)
// ============================================================

export interface CashierSessionItem {
  session_id: string;
  table_label: string;
  area_name: string;
  title: string | null;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  status: string;
  started_at: string;
  reservation_at: string | null;
  reservation_end_at: string | null;
  subtotal: number;
  paid_total: number;
  /** Sisa yang belum dibayar (subtotal - paid) */
  outstanding: number;
  is_paid: boolean;
  /** True kalau session dibuka oleh staff (walk-in customer tanpa HP) */
  is_walk_in: boolean;
  /** Nama staff yang buka meja (kalau walk-in). Null untuk session customer regular */
  opened_by_staff_name: string | null;
  /** Nama-nama tamu di meja (kalau walk-in). Empty array untuk session customer regular */
  guest_names: string[];
}

export async function getActiveSessionsForCashier(): Promise<
  CashierSessionItem[]
> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  // Active sessions di bar (open/locked) — include walk-in metadata
  const sessionRows = await db
    .select({
      id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      title: tableSessions.title,
      host_id: tableSessions.hostId,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
      started_at: tableSessions.startedAt,
      status: tableSessions.status,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      opened_by_staff_id: tableSessions.openedByStaffId,
      guest_names: tableSessions.guestNames,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        inArray(tableSessions.status, ["open", "locked", "overdue"])
      )
    )
    .orderBy(asc(tableSessions.startedAt));

  if (sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((s) => s.id);

  // Bill aggregate per session
  const bills = await db
    .select({
      session_id: orders.sessionId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orders)
    .leftJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
    )
    .where(inArray(orders.sessionId, sessionIds))
    .groupBy(orders.sessionId);

  const billMap = new Map(bills.map((b) => [b.session_id, Number(b.subtotal)]));

  // Paid aggregate per session
  const paidRows = await db
    .select({
      session_id: orders.sessionId,
      paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(inArray(orders.sessionId, sessionIds), eq(payments.status, "paid"))
    )
    .groupBy(orders.sessionId);

  const paidMap = new Map(paidRows.map((p) => [p.session_id, Number(p.paid)]));

  // Member count per session
  const memberCountRows = await db
    .select({
      session_id: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(sessionMembers)
    .where(
      and(
        inArray(sessionMembers.sessionId, sessionIds),
        eq(sessionMembers.status, "joined")
      )
    )
    .groupBy(sessionMembers.sessionId);

  const memberMap = new Map(
    memberCountRows.map((m) => [m.session_id, Number(m.count)])
  );

  // Batch lookup nama staff yang buka session walk-in (unique IDs)
  const staffIds = Array.from(
    new Set(
      sessionRows
        .map((s) => s.opened_by_staff_id)
        .filter((id): id is string => !!id)
    )
  );
  const staffNameMap = new Map<string, string>();
  if (staffIds.length > 0) {
    const staffRows = await db
      .select({ id: profiles.id, name: profiles.displayName })
      .from(profiles)
      .where(inArray(profiles.id, staffIds));
    for (const row of staffRows) {
      staffNameMap.set(row.id, row.name);
    }
  }

  const charge = await getChargeConfig(ctx.barId);

  return sessionRows.map((s) => {
    const subtotal = billMap.get(s.id) ?? 0;
    const paid = paidMap.get(s.id) ?? 0;
    const bill = computeBillTotals(subtotal, charge);
    return {
      session_id: s.id,
      table_label: s.table_label,
      area_name: s.area_name,
      title: s.title,
      host_name: s.host_name,
      host_avatar: s.host_avatar,
      member_count: memberMap.get(s.id) ?? 0,
      status: s.status,
      started_at: s.started_at.toISOString(),
      reservation_at: s.reservation_at ? s.reservation_at.toISOString() : null,
      reservation_end_at: s.reservation_end_at
        ? s.reservation_end_at.toISOString()
        : null,
      subtotal,
      paid_total: paid,
      outstanding: Math.max(0, bill.total - paid),
      is_paid: bill.total > 0 && paid >= bill.total,
      is_walk_in: !!s.opened_by_staff_id,
      opened_by_staff_name: s.opened_by_staff_id
        ? staffNameMap.get(s.opened_by_staff_id) ?? null
        : null,
      guest_names: s.guest_names ?? [],
    };
  });
}

/**
 * Sesi yang sudah SELESAI (closed) — untuk tab "Selesai" di dashboard kasir.
 * Terbaru dulu (50). Bentuk = CashierSessionItem (reuse kartu).
 */
export async function getClosedSessionsForCashier(): Promise<
  CashierSessionItem[]
> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  const sessionRows = await db
    .select({
      id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      title: tableSessions.title,
      host_id: tableSessions.hostId,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
      started_at: tableSessions.startedAt,
      status: tableSessions.status,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      opened_by_staff_id: tableSessions.openedByStaffId,
      guest_names: tableSessions.guestNames,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        eq(tableSessions.status, "closed")
      )
    )
    .orderBy(desc(tableSessions.closedAt))
    .limit(50);

  if (sessionRows.length === 0) return [];
  const sessionIds = sessionRows.map((s) => s.id);

  const bills = await db
    .select({
      session_id: orders.sessionId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orders)
    .leftJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
    )
    .where(inArray(orders.sessionId, sessionIds))
    .groupBy(orders.sessionId);
  const billMap = new Map(bills.map((b) => [b.session_id, Number(b.subtotal)]));

  const paidRows = await db
    .select({
      session_id: orders.sessionId,
      paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(inArray(orders.sessionId, sessionIds), eq(payments.status, "paid"))
    )
    .groupBy(orders.sessionId);
  const paidMap = new Map(paidRows.map((p) => [p.session_id, Number(p.paid)]));

  const memberCountRows = await db
    .select({
      session_id: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(sessionMembers)
    .where(
      and(
        inArray(sessionMembers.sessionId, sessionIds),
        eq(sessionMembers.status, "joined")
      )
    )
    .groupBy(sessionMembers.sessionId);
  const memberMap = new Map(
    memberCountRows.map((m) => [m.session_id, Number(m.count)])
  );

  const staffIds = Array.from(
    new Set(
      sessionRows
        .map((s) => s.opened_by_staff_id)
        .filter((id): id is string => !!id)
    )
  );
  const staffNameMap = new Map<string, string>();
  if (staffIds.length > 0) {
    const staffRows = await db
      .select({ id: profiles.id, name: profiles.displayName })
      .from(profiles)
      .where(inArray(profiles.id, staffIds));
    for (const row of staffRows) staffNameMap.set(row.id, row.name);
  }

  const charge = await getChargeConfig(ctx.barId);

  return sessionRows.map((s) => {
    const subtotal = billMap.get(s.id) ?? 0;
    const paid = paidMap.get(s.id) ?? 0;
    const bill = computeBillTotals(subtotal, charge);
    return {
      session_id: s.id,
      table_label: s.table_label,
      area_name: s.area_name,
      title: s.title,
      host_name: s.host_name,
      host_avatar: s.host_avatar,
      member_count: memberMap.get(s.id) ?? 0,
      status: s.status,
      started_at: s.started_at.toISOString(),
      reservation_at: s.reservation_at ? s.reservation_at.toISOString() : null,
      reservation_end_at: s.reservation_end_at
        ? s.reservation_end_at.toISOString()
        : null,
      subtotal,
      paid_total: paid,
      outstanding: Math.max(0, bill.total - paid),
      is_paid: bill.total > 0 && paid >= bill.total,
      is_walk_in: !!s.opened_by_staff_id,
      opened_by_staff_name: s.opened_by_staff_id
        ? staffNameMap.get(s.opened_by_staff_id) ?? null
        : null,
      guest_names: s.guest_names ?? [],
    };
  });
}

// ============================================================
// BOOKINGS (reservasi terjadwal — untuk tab "Booking" kasir)
// ============================================================

export interface CashierBookingItem {
  session_id: string;
  table_label: string;
  area_name: string;
  title: string | null;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  table_capacity: number;
  reservation_at: string;
  reservation_end_at: string | null;
}

/**
 * Daftar reservasi TERJADWAL (status 'reserved') di bar — untuk kasir.
 * Permission receive_payment (kasir/manager/admin). Urut by reservation_at.
 */
export async function getBookingsForCashier(): Promise<CashierBookingItem[]> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  const rows = await db
    .select({
      id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      title: tableSessions.title,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      table_capacity: tables.capacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        eq(tableSessions.status, "reserved")
      )
    )
    .orderBy(asc(tableSessions.reservationAt));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const memberRows = await db
    .select({
      session_id: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(sessionMembers)
    .where(
      and(
        inArray(sessionMembers.sessionId, ids),
        eq(sessionMembers.status, "joined")
      )
    )
    .groupBy(sessionMembers.sessionId);
  const memberMap = new Map(
    memberRows.map((m) => [m.session_id, Number(m.count)])
  );

  return rows.map((r) => ({
    session_id: r.id,
    table_label: r.table_label,
    area_name: r.area_name,
    title: r.title,
    host_name: r.host_name,
    host_avatar: r.host_avatar,
    member_count: memberMap.get(r.id) ?? 0,
    table_capacity: r.table_capacity,
    reservation_at: r.reservation_at
      ? r.reservation_at.toISOString()
      : new Date().toISOString(),
    reservation_end_at: r.reservation_end_at
      ? r.reservation_end_at.toISOString()
      : null,
  }));
}

// ============================================================
// SESSION DETAIL
// ============================================================

export interface CashierBillItem {
  id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  menu_item_name: string;
  added_by_name: string;
}

export interface CashierPayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: string;
  paid_at: string | null;
  created_at: string;
  is_down_payment: boolean;
  qr_string: string | null;
  expires_at: string | null;
  paid_by_name: string;
  /** Rincian item yang dicakup pembayaran itemized (kosong utk DP/equal/treat). */
  items: { name: string; quantity: number; amount: number }[];
}

export interface CashierMember {
  member_id: string;
  profile_id: string;
  display_name: string;
  avatar_url: string | null;
  is_host: boolean;
}

export interface CashierSessionDetail {
  session_id: string;
  status: string;
  table_label: string;
  table_capacity: number;
  area_name: string;
  title: string | null;
  host_id: string;
  host_name: string;
  host_avatar: string | null;
  started_at: string;
  reservation_at: string | null;
  reservation_end_at: string | null;
  order_id: string | null;
  items: CashierBillItem[];
  payments: CashierPayment[];
  members: CashierMember[];
  subtotal: number;
  /** Pajak (dari config bar). */
  tax: number;
  /** Service charge (dari config bar). */
  service: number;
  /** Gabungan tax + service (ditampilkan 1 baris). */
  charge: number;
  /** Persen gabungan (taxPercent + servicePercent). */
  charge_percent: number;
  /** subtotal + tax + service (yang harus dibayar). */
  total: number;
  paid_total: number;
  /** total - paid_total (sisa yang harus dibayar). */
  outstanding: number;
  /** True kalau session dibuka oleh staff (walk-in customer) */
  is_walk_in: boolean;
  /** Nama staff yang buka meja (kalau walk-in) */
  opened_by_staff_name: string | null;
  /** Daftar nama tamu di meja (kalau walk-in) */
  guest_names: string[];
}

export async function getSessionDetailForCashier(
  sessionId: string
): Promise<CashierSessionDetail | null> {
  const ctx = await requirePermission(
    "receive_payment",
    `/staff/cashier/${sessionId}`
  );

  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      table_label: tables.label,
      table_capacity: tables.capacity,
      area_name: floorAreas.name,
      bar_id: floorAreas.barId,
      title: tableSessions.title,
      host_id: tableSessions.hostId,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
      started_at: tableSessions.startedAt,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      opened_by_staff_id: tableSessions.openedByStaffId,
      guest_names: tableSessions.guestNames,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(eq(tableSessions.id, sessionId));

  if (!row) return null;
  if (row.bar_id !== ctx.barId) return null;

  // Lookup nama staff yang buka meja (kalau walk-in)
  let openedByStaffName: string | null = null;
  if (row.opened_by_staff_id) {
    const [staffRow] = await db
      .select({ name: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.id, row.opened_by_staff_id));
    if (staffRow) openedByStaffName = staffRow.name;
  }

  // Order sesi (terbaru). JANGAN filter status — sesi closed punya order closed,
  // tapi bill/item-nya tetap harus ditampilkan & sisa tagihan tetap bisa dibayar.
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.sessionId, sessionId))
    .orderBy(desc(orders.createdAt))
    .limit(1);

  // Items
  const itemsRaw = order
    ? await db
        .select({
          id: orderItems.id,
          quantity: orderItems.quantity,
          unit_price: orderItems.unitPrice,
          notes: orderItems.notes,
          menu_item_name: menuItems.name,
          added_by_name: profiles.displayName,
        })
        .from(orderItems)
        .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
        .innerJoin(
          sessionMembers,
          eq(sessionMembers.id, orderItems.addedByMemberId)
        )
        .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
        .where(
          and(eq(orderItems.orderId, order.id), ne(orderItems.status, "void"))
        )
        .orderBy(orderItems.createdAt)
    : [];

  // Payments
  const paymentsRaw = order
    ? await db
        .select({
          id: payments.id,
          amount: payments.amount,
          method: payments.method,
          status: payments.status,
          paid_at: payments.paidAt,
          created_at: payments.createdAt,
          split_meta: payments.splitMeta,
          paid_by_name: profiles.displayName,
        })
        .from(payments)
        .innerJoin(
          sessionMembers,
          eq(sessionMembers.id, payments.paidByMemberId)
        )
        .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
        .where(eq(payments.orderId, order.id))
        .orderBy(payments.createdAt)
    : [];

  // Payment items (rincian item per pembayaran itemized) — untuk riwayat kasir.
  const paymentItemsRaw = order
    ? await db
        .select({
          payment_id: paymentItems.paymentId,
          amount: paymentItems.amount,
          quantity: orderItems.quantity,
          name: menuItems.name,
        })
        .from(paymentItems)
        .innerJoin(payments, eq(payments.id, paymentItems.paymentId))
        .innerJoin(orderItems, eq(orderItems.id, paymentItems.orderItemId))
        .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
        .where(eq(payments.orderId, order.id))
    : [];
  const itemsByPayment = new Map<
    string,
    { name: string; quantity: number; amount: number }[]
  >();
  for (const pi of paymentItemsRaw) {
    const arr = itemsByPayment.get(pi.payment_id) ?? [];
    arr.push({ name: pi.name, quantity: pi.quantity, amount: pi.amount });
    itemsByPayment.set(pi.payment_id, arr);
  }

  // Members
  const membersRaw = await db
    .select({
      member_id: sessionMembers.id,
      profile_id: profiles.id,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
      role: sessionMembers.role,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "joined")
      )
    )
    .orderBy(sessionMembers.joinedAt);

  const subtotal = itemsRaw.reduce(
    (s, i) => s + i.quantity * i.unit_price,
    0
  );
  const paid_total = paymentsRaw
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  // Tax & service dari config bar → total yang harus dibayar.
  const charge = await getChargeConfig(row.bar_id);
  const bill = computeBillTotals(subtotal, charge);

  return {
    session_id: row.id,
    status: row.status,
    table_label: row.table_label,
    table_capacity: row.table_capacity,
    area_name: row.area_name,
    title: row.title,
    host_id: row.host_id,
    host_name: row.host_name,
    host_avatar: row.host_avatar,
    started_at: row.started_at.toISOString(),
    reservation_at: row.reservation_at
      ? row.reservation_at.toISOString()
      : null,
    reservation_end_at: row.reservation_end_at
      ? row.reservation_end_at.toISOString()
      : null,
    order_id: order?.id ?? null,
    items: itemsRaw.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      notes: i.notes,
      menu_item_name: i.menu_item_name,
      added_by_name: i.added_by_name,
    })),
    payments: paymentsRaw.map((p) => {
      const meta = (p.split_meta ?? {}) as {
        isDownPayment?: boolean;
        qrString?: string;
        expiresAt?: string | null;
      };
      return {
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        paid_at: p.paid_at ? p.paid_at.toISOString() : null,
        created_at: p.created_at.toISOString(),
        is_down_payment: !!meta.isDownPayment,
        qr_string: meta.qrString ?? null,
        expires_at: meta.expiresAt ?? null,
        paid_by_name: p.paid_by_name,
        items: itemsByPayment.get(p.id) ?? [],
      };
    }),
    members: membersRaw.map((m) => ({
      member_id: m.member_id,
      profile_id: m.profile_id,
      display_name: m.display_name,
      avatar_url: m.avatar_url,
      is_host: m.role === "host",
    })),
    subtotal,
    tax: bill.tax,
    service: bill.service,
    charge: bill.charge,
    charge_percent: bill.chargePercent,
    total: bill.total,
    paid_total,
    outstanding: Math.max(0, bill.total - paid_total),
    is_walk_in: !!row.opened_by_staff_id,
    opened_by_staff_name: openedByStaffName,
    guest_names: row.guest_names ?? [],
  };
}

// ============================================================
// CREATE PAYMENT (via gateway)
// ============================================================

const createPaymentSchema = z.object({
  sessionId: z.string().uuid(),
  payerMemberId: z.string().uuid(),
  amount: z.number().int().positive(),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
  /** Untuk cash: nominal yang diterima dari customer (untuk hitung kembalian) */
  cashReceived: z.number().int().positive().optional(),
});

export interface CreatePaymentResult {
  paymentId: string;
  status: string;
  externalRef: string;
  qrString: string | null;
  /** QRIS: waktu kedaluwarsa (ISO). Null untuk method lain. */
  expiresAt: string | null;
  /** Untuk cash: kembalian (cashReceived - amount). Null untuk method lain. */
  change: number | null;
}

export async function cashierCreatePayment(
  input: z.infer<typeof createPaymentSchema>
): Promise<CreatePaymentResult> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");
  const data = createPaymentSchema.parse(input);

  // 1. Validate session di bar yang sama
  const [sessionRow] = await db
    .select({ bar_id: floorAreas.barId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, data.sessionId));
  if (!sessionRow) throw new Error("Session not found");
  if (sessionRow.bar_id !== ctx.barId) {
    throw new Error("Invalid bar access");
  }

  // 2. Get order sesi. Sesi closed yg masih punya sisa tagihan tetap boleh
  //    dibayar (tamu bayar belakangan) → jangan filter status order.
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.sessionId, data.sessionId))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (!order) throw new Error("Order not found");

  // 3. Validate payer is joined member
  const [member] = await db
    .select({
      id: sessionMembers.id,
      displayName: profiles.displayName,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.id, data.payerMemberId),
        eq(sessionMembers.sessionId, data.sessionId),
        eq(sessionMembers.status, "joined")
      )
    );
  if (!member) throw new Error("Invalid member");

  // 3b. Cap ke sisa tagihan (outstanding = TOTAL - paid, di mana total =
  //     subtotal + tax + service). Cegah overpayment yg bikin desync.
  const [billAgg] = await db
    .select({
      subtotal: sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), ne(orderItems.status, "void")));
  const [paidAgg] = await db
    .select({
      paid: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "paid")));
  const charge = await getChargeConfig(ctx.barId);
  const bill = computeBillTotals(Number(billAgg?.subtotal ?? 0), charge);
  const outstanding = Math.max(0, bill.total - Number(paidAgg?.paid ?? 0));
  if (outstanding <= 0) {
    throw new Error("This bill is already fully paid");
  }
  if (data.amount > outstanding) {
    throw new Error(
      `Amount exceeds the outstanding balance (${outstanding})`
    );
  }

  // 4. Validate cash kalau method cash
  let change: number | null = null;
  if (data.method === "cash") {
    if (!data.cashReceived) {
      throw new Error("Received amount is required for cash payment");
    }
    if (data.cashReceived < data.amount) {
      throw new Error("Received amount is less than the total");
    }
    change = data.cashReceived - data.amount;
  }

  // 5. Insert payment row (status pending — gateway yang update)
  const [newPayment] = await db
    .insert(payments)
    .values({
      orderId: order.id,
      paidByMemberId: data.payerMemberId,
      amount: data.amount,
      method: data.method,
      status: "pending",
      splitMode: "equal" as SplitMode,
      splitMeta: { cashReceived: data.cashReceived, change },
      paidAt: null,
    })
    .returning({ id: payments.id });

  // 6. Call gateway untuk create charge
  const gateway = getPaymentGateway();
  const chargeResult = await gateway.createCharge({
    paymentId: newPayment.id,
    amount: data.amount,
    method: data.method,
    payerName: member.displayName,
    description: `Table payment - ${data.sessionId.slice(0, 8)}`,
  });

  // 7. Update payment dengan hasil gateway (external ref, status awal).
  //    Simpan metadata QRIS (qrString/redirectUrl/expiry/merchantOrderId) di
  //    split_meta jsonb supaya bisa di-render ulang & lookup saat callback.
  await db
    .update(payments)
    .set({
      externalRef: chargeResult.externalRef,
      status: chargeResult.status,
      paidAt: chargeResult.status === "paid" ? new Date() : null,
      splitMeta: {
        cashReceived: data.cashReceived,
        change,
        qrString: chargeResult.qrString ?? null,
        redirectUrl: chargeResult.redirectUrl ?? null,
        expiresAt: chargeResult.expiresAt ?? null,
        merchantOrderId: chargeResult.merchantOrderId ?? newPayment.id,
      },
    })
    .where(eq(payments.id, newPayment.id));

  // 8. Notify realtime (session + staff + bar)
  await notifyAll(data.sessionId, ctx.barId, { type: "payment.created" });

  revalidatePath(`/staff/cashier/${data.sessionId}`);
  revalidatePath("/staff/cashier");

  return {
    paymentId: newPayment.id,
    status: chargeResult.status,
    externalRef: chargeResult.externalRef,
    qrString: chargeResult.qrString ?? null,
    expiresAt: chargeResult.expiresAt ?? null,
    change,
  };
}

/**
 * Manual mark payment sebagai paid (untuk method non-gateway atau cashier
 * konfirmasi customer sudah bayar).
 *
 * Gateway integration nanti: bisa polling checkStatus → auto update,
 * atau callback webhook → endpoint API yang call ini.
 */
export async function cashierMarkPaymentPaid(paymentId: string): Promise<void> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  const [payment] = await db
    .select({
      id: payments.id,
      sessionId: orders.sessionId,
      barId: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(payments.id, paymentId));

  if (!payment) throw new Error("Payment not found");
  if (payment.barId !== ctx.barId) throw new Error("Invalid bar access");

  await db
    .update(payments)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(payments.id, paymentId));

  // Sesi 'overdue' yang kini lunas → tutup otomatis.
  await settleOverdueIfPaid(payment.sessionId);

  await notifyAll(payment.sessionId, ctx.barId, { type: "payment.paid" });

  revalidatePath(`/staff/cashier/${payment.sessionId}`);
  revalidatePath("/staff/cashier");
}

/**
 * Cancel/refund payment (kalau cashier salah input atau customer batal).
 * Set status ke "failed" supaya tidak count ke paid_total.
 */
export async function cashierCancelPayment(paymentId: string): Promise<void> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  const [payment] = await db
    .select({
      id: payments.id,
      sessionId: orders.sessionId,
      barId: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(payments.id, paymentId));

  if (!payment) throw new Error("Payment not found");
  if (payment.barId !== ctx.barId) throw new Error("Invalid bar access");

  await db
    .update(payments)
    .set({ status: "failed", paidAt: null })
    .where(eq(payments.id, paymentId));

  await notifyAll(payment.sessionId, ctx.barId, { type: "payment.cancelled" });
  await notifyPaymentEvent(paymentId, "cancelled");

  revalidatePath(`/staff/cashier/${payment.sessionId}`);
  revalidatePath("/staff/cashier");
}

/**
 * Tandai payment paid oleh SISTEM (callback gateway / hasil polling) — TANPA
 * auth cashier. Dipakai callback Duitku & cashierCheckPaymentStatus.
 * Idempotent: kalau sudah paid, tidak melakukan apa-apa. Return sessionId+barId
 * (null kalau payment tak ada) untuk revalidate/notify di pemanggil.
 */
export async function markPaymentPaidBySystem(
  paymentId: string
): Promise<{ sessionId: string; barId: string } | null> {
  const [payment] = await db
    .select({
      id: payments.id,
      status: payments.status,
      splitMeta: payments.splitMeta,
      sessionId: orders.sessionId,
      barId: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(payments.id, paymentId));
  if (!payment) return null;
  if (payment.status === "paid") {
    return { sessionId: payment.sessionId, barId: payment.barId };
  }

  await db
    .update(payments)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(payments.id, paymentId));

  // DP booking lunas → tandai dp_paid_at (booking terkonfirmasi).
  const meta =
    (payment.splitMeta as { isDownPayment?: boolean } | null) ?? {};
  if (meta.isDownPayment) {
    await db
      .update(tableSessions)
      .set({ dpPaidAt: new Date() })
      .where(eq(tableSessions.id, payment.sessionId));
  }

  await settleOverdueIfPaid(payment.sessionId);
  await notifyAll(payment.sessionId, payment.barId, { type: "payment.paid" });
  // Notif in-app + push ke host/pembayar/staff.
  await notifyPaymentEvent(payment.id, meta.isDownPayment ? "dp_confirmed" : "paid");
  revalidatePath(`/staff/cashier/${payment.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath(`/session/${payment.sessionId}`);
  return { sessionId: payment.sessionId, barId: payment.barId };
}

/**
 * Poll status pembayaran ke gateway (mis. QRIS Duitku). Kalau gateway
 * melaporkan lunas → tandai paid. Dipakai tombol "Cek Status" di UI kasir
 * sebagai cadangan kalau callback telat/gagal.
 */
export async function cashierCheckPaymentStatus(
  paymentId: string
): Promise<{ status: string }> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  const [payment] = await db
    .select({
      id: payments.id,
      status: payments.status,
      barId: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(payments.id, paymentId));
  if (!payment) throw new Error("Payment not found");
  if (payment.barId !== ctx.barId) throw new Error("Invalid bar access");
  if (payment.status === "paid") return { status: "paid" };

  // Duitku transactionStatus di-lookup by merchantOrderId (= payment.id).
  const gateway = getPaymentGateway();
  const gwStatus = await gateway.checkStatus(payment.id);
  if (gwStatus === "paid") {
    await markPaymentPaidBySystem(payment.id);
    return { status: "paid" };
  }
  return { status: gwStatus };
}

// ============================================================
// CLOSE SESSION (cashier-initiated)
// ============================================================

/**
 * Tutup meja oleh cashier. Berbeda dari closeSession existing (yang
 * di-trigger oleh host) — cashier punya permission "close_session" yang
 * lebih luas (bisa close meja siapa saja di bar mereka).
 *
 * Setelah close: session + order jadi closed, kembalikan session_id supaya
 * UI redirect ke struk page.
 */
export async function cashierCloseSession(sessionId: string): Promise<void> {
  const ctx = await requirePermission("close_session", "/staff/cashier");

  // Validate session di bar yang sama
  const [row] = await db
    .select({ bar_id: floorAreas.barId, status: tableSessions.status })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.bar_id !== ctx.barId) throw new Error("Invalid bar access");
  if (row.status === "closed") throw new Error("Table is already closed");

  const now = new Date();
  await Promise.all([
    db
      .update(tableSessions)
      .set({ status: "closed", closedAt: now })
      .where(eq(tableSessions.id, sessionId)),
    db
      .update(orders)
      .set({ status: "closed", closedAt: now })
      .where(eq(orders.sessionId, sessionId)),
  ]);

  await notifyAll(sessionId, ctx.barId, { type: "session.closed" });

  revalidatePath(`/staff/cashier/${sessionId}`);
  revalidatePath("/staff/cashier");
}

// ============================================================
// SHIFT REPORT
// ============================================================

export interface ShiftTransaction {
  session_id: string;
  closed_at: string;
  table_label: string;
  area_name: string;
  host_name: string;
  subtotal: number;
  paid_total: number;
  cash_total: number;
  noncash_total: number;
  payment_methods: string[];
}

export interface ShiftSummary {
  transaction_count: number;
  total_revenue: number;
  cash_revenue: number;
  noncash_revenue: number;
}

export async function getShiftReport(
  fromIso: string,
  toIso: string
): Promise<{ summary: ShiftSummary; transactions: ShiftTransaction[] }> {
  const ctx = await requirePermission("view_shift_report", "/staff/cashier/shift");

  const from = new Date(fromIso);
  const to = new Date(toIso);

  // Session yang closed di range, di bar yang sama, where cashier ini ada
  // payment-nya. Cashier "ngerjain" meja = ada payment row yang dia process.
  // Untuk simplification: kita query session yang ada payment dimana payer
  // di-process oleh cashier-related action — tapi kita tidak track cashier_id
  // di payments table. Sebagai gantinya, untuk MVP: tampilkan semua
  // transaksi closed di range (semua cashier melihat data sama).
  //
  // Future: tambah field payments.processed_by_id = cashier user, filter per
  // cashier supaya shift report per-cashier.

  // Basis shift report = UANG YANG DITERIMA di rentang shift (payments.paid_at),
  // bukan sesi yg closed. Ini menangkap pelunasan-belakangan (bayar sisa hari ini
  // utk sesi yg di-close kemarin) & mencocokkan cash drawer dgn kas fisik.
  const payRows = await db
    .select({
      session_id: orders.sessionId,
      method: payments.method,
      amount: payments.amount,
      paid_at: payments.paidAt,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        eq(payments.status, "paid"),
        isNotNull(payments.paidAt),
        gte(payments.paidAt, from),
        lt(payments.paidAt, to)
      )
    );

  if (payRows.length === 0) {
    return {
      summary: {
        transaction_count: 0,
        total_revenue: 0,
        cash_revenue: 0,
        noncash_revenue: 0,
      },
      transactions: [],
    };
  }

  // Agregasi per sesi (uang diterima di shift ini).
  type PayAcc = {
    paid_total: number;
    cash_total: number;
    noncash_total: number;
    methods: Set<string>;
    last_paid_at: Date;
  };
  const payMap = new Map<string, PayAcc>();
  for (const r of payRows) {
    const acc = payMap.get(r.session_id) ?? {
      paid_total: 0,
      cash_total: 0,
      noncash_total: 0,
      methods: new Set<string>(),
      last_paid_at: r.paid_at as Date,
    };
    const amount = Number(r.amount);
    acc.paid_total += amount;
    if (r.method === "cash") acc.cash_total += amount;
    else acc.noncash_total += amount;
    acc.methods.add(r.method);
    if ((r.paid_at as Date) > acc.last_paid_at)
      acc.last_paid_at = r.paid_at as Date;
    payMap.set(r.session_id, acc);
  }

  const sessionIds = Array.from(payMap.keys());

  // Info sesi (label/area/host) + subtotal (utk konteks tampilan).
  const sessionRows = await db
    .select({
      session_id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      host_name: profiles.displayName,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(inArray(tableSessions.id, sessionIds));
  const infoMap = new Map(sessionRows.map((s) => [s.session_id, s]));

  const billRows = await db
    .select({
      session_id: orders.sessionId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orders)
    .leftJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
    )
    .where(inArray(orders.sessionId, sessionIds))
    .groupBy(orders.sessionId);
  const billMap = new Map(
    billRows.map((b) => [b.session_id, Number(b.subtotal)])
  );

  const transactions: ShiftTransaction[] = Array.from(payMap.entries())
    .map(([sessionId, pay]) => {
      const info = infoMap.get(sessionId);
      return {
        session_id: sessionId,
        // "closed_at" di sini = waktu pembayaran terakhir di shift (kapan uang masuk).
        closed_at: pay.last_paid_at.toISOString(),
        table_label: info?.table_label ?? "-",
        area_name: info?.area_name ?? "-",
        host_name: info?.host_name ?? "-",
        subtotal: billMap.get(sessionId) ?? 0,
        paid_total: pay.paid_total,
        cash_total: pay.cash_total,
        noncash_total: pay.noncash_total,
        payment_methods: Array.from(pay.methods),
      };
    })
    .sort((a, b) => b.closed_at.localeCompare(a.closed_at));

  const summary: ShiftSummary = {
    transaction_count: transactions.length,
    total_revenue: transactions.reduce((s, t) => s + t.paid_total, 0),
    cash_revenue: transactions.reduce((s, t) => s + t.cash_total, 0),
    noncash_revenue: transactions.reduce((s, t) => s + t.noncash_total, 0),
  };

  return { summary, transactions };
}
