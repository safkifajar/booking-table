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
  isNull,
  lt,
  ne,
  notInArray,
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
import { staffRoles } from "@/lib/db/schema/extras";
import { createNotification } from "@/lib/notifications";
import { requirePermission } from "@/lib/auth-v2/permissions";
import { sortUnpaidFirst } from "@/lib/session-sort";
import { getPaymentGateway } from "@/lib/payments/gateway";
import {
  resolveVoucherForBillPayment,
  reserveVoucherForPayment,
  settleVoucherForPayment,
  releaseVoucherForPayment,
} from "@/lib/member-voucher";
import {
  settleRevenueSplitForPayment,
  settleRevenueSplitForMembershipTx,
} from "@/lib/revenue-split";
import { notifyAll } from "@/lib/realtime/notify";
import {
  settleOverdueIfPaid,
  settleOrderIfPaid,
  expireOverdueDpBookings,
  expireOverduePayAtCashierOrders,
} from "@/lib/queries";
import { sendBookingInvites } from "@/lib/actions";
import { notifyPaymentEvent } from "@/lib/payment-notify";
import { logActivity } from "@/lib/activity-log";
import { formatIDR } from "@/lib/utils";
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
  /** Kapan sesi ditutup (null = masih aktif) — utk filter "hari ini" & urutan. */
  closed_at: string | null;
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
  /** Jumlah payment "Pay at cashier" yang menunggu konfirmasi kasir. */
  cash_pending_count: number;
  /** Order pertama yg menunggu konfirmasi pay-at-cashier → deep-link ke order
   *  detail (kasir langsung ke layar konfirmasi). Null kalau tak ada. */
  cash_pending_order_id: string | null;
}

export async function getActiveSessionsForCashier(): Promise<
  CashierSessionItem[]
> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  // Lazy-expire order pay-at-cashier yang lewat 10 mnt (order dibatalkan, meja
  // tetap open) sebelum menampilkan daftar — biar badge & angka akurat.
  await expireOverduePayAtCashierOrders(ctx.barId).catch((e) =>
    console.error("[cashier] expire pay-at-cashier order sweep:", e)
  );

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
      closed_at: tableSessions.closedAt,
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
    // Kasir hanya lihat order yg sudah "masuk": exclude unpaid (belum dibayar)
    // & cancelled (dibatalkan customer).
    .where(
      and(
        inArray(orders.sessionId, sessionIds),
        notInArray(orders.status, ["unpaid", "cancelled"])
      )
    )
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
      and(
        inArray(orders.sessionId, sessionIds),
        eq(payments.status, "paid"),
        // Konsisten dgn subtotal: payment milik order unpaid/cancelled tak
        // dihitung (mis. order cancelled yg terlanjur punya payment paid).
        notInArray(orders.status, ["unpaid", "cancelled"])
      )
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

  // Payment "Pay at cashier" pending per session — customer menunggu
  // konfirmasi di kasir (order belum masuk dapur sampai dikonfirmasi).
  // Ambil per-baris (bukan cuma count) supaya bisa deep-link ke order detail
  // order yang menunggu (kasir langsung ke layar konfirmasi).
  const cashPendingRows = await db
    .select({
      session_id: orders.sessionId,
      order_id: orders.id,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        inArray(orders.sessionId, sessionIds),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`,
        notInArray(orders.status, ["cancelled"])
      )
    )
    .orderBy(asc(payments.createdAt));
  const cashPendingMap = new Map<string, number>();
  // Order pertama yang menunggu per sesi → target deep-link.
  const cashPendingOrderMap = new Map<string, string>();
  for (const r of cashPendingRows) {
    cashPendingMap.set(r.session_id, (cashPendingMap.get(r.session_id) ?? 0) + 1);
    if (!cashPendingOrderMap.has(r.session_id)) {
      cashPendingOrderMap.set(r.session_id, r.order_id);
    }
  }

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

  const rows = sessionRows.map((s) => {
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
      closed_at: s.closed_at ? s.closed_at.toISOString() : null,
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
      cash_pending_count: cashPendingMap.get(s.id) ?? 0,
      cash_pending_order_id: cashPendingOrderMap.get(s.id) ?? null,
    };
  });

  return sortUnpaidFirst(rows);
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
      closed_at: tableSessions.closedAt,
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
    .where(
      and(
        inArray(orders.sessionId, sessionIds),
        notInArray(orders.status, ["unpaid", "cancelled"])
      )
    )
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
      and(
        inArray(orders.sessionId, sessionIds),
        eq(payments.status, "paid"),
        // Konsisten dgn subtotal: payment milik order unpaid/cancelled tak
        // dihitung (mis. order cancelled yg terlanjur punya payment paid).
        notInArray(orders.status, ["unpaid", "cancelled"])
      )
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

  const rows = sessionRows.map((s) => {
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
      closed_at: s.closed_at ? s.closed_at.toISOString() : null,
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
      cash_pending_count: 0,
      cash_pending_order_id: null,
    };
  });

  return sortUnpaidFirst(rows);
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
  /** DP pending "Pay at cashier" — customer menunggu konfirmasi di kasir. */
  dp_pending_cashier: {
    payment_id: string;
    /** Order pemilik DP — untuk link langsung ke order detail (konfirmasi cepat). */
    order_id: string;
    amount: number;
    expires_at: string | null;
  } | null;
}

/**
 * Daftar reservasi TERJADWAL (status 'reserved') di bar — untuk kasir.
 * Permission receive_payment (kasir/manager/admin). Urut by reservation_at.
 * Sekalian sweep DP basi (lazy expiry) supaya booking yang lewat batas
 * konfirmasi hilang dari daftar & mejanya bebas lagi.
 */
export async function getBookingsForCashier(): Promise<CashierBookingItem[]> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  // Lazy expiry: batalkan booking yang DP-nya lewat batas (QRIS 60 dtk /
  // pay-at-cashier 10 menit) sebelum menampilkan daftar.
  await expireOverdueDpBookings(ctx.barId).catch((e) =>
    console.error("[cashier] expire DP sweep:", e)
  );

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

  // DP pending "Pay at cashier" per booking (kasir perlu tahu siapa yang
  // sedang menunggu konfirmasi + sisa waktunya).
  const dpRows = await db
    .select({
      session_id: orders.sessionId,
      order_id: orders.id,
      payment_id: payments.id,
      amount: payments.amount,
      split_meta: payments.splitMeta,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        inArray(orders.sessionId, ids),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`,
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`
      )
    );
  const dpMap = new Map(
    dpRows.map((d) => {
      const meta = (d.split_meta ?? {}) as { expiresAt?: string | null };
      return [
        d.session_id,
        {
          payment_id: d.payment_id,
          order_id: d.order_id,
          amount: d.amount,
          expires_at: meta.expiresAt ?? null,
        },
      ];
    })
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
    dp_pending_cashier: dpMap.get(r.id) ?? null,
  }));
}

// ============================================================
// ORDER QUEUE (KASIR) — kasir = jembatan ke dapur
// ============================================================

/** Satu item order untuk tab Orders kasir (per item, dikelompokkan per meja
 *  di UI). status 'sent' = perlu diteruskan; 'preparing' = kasir sudah teruskan
 *  (dapur sedang buat). */
export interface CashierOrderItem {
  id: string;
  order_id: string;
  quantity: number;
  notes: string | null;
  created_at: string;
  status: "sent" | "preparing";
  menu_item_name: string;
  menu_item_image: string | null;
  added_by_name: string;
  added_by_avatar: string | null;
  session_id: string;
  session_title: string | null;
  table_label: string;
  area_name: string;
  reservation_at: string | null;
}

/** Dua kelompok order untuk kasir: aktif (dapur buat sekarang) vs terjadwal
 *  (booking, jam belum tiba → dapur belum boleh buat). */
export interface CashierOrderQueue {
  active: CashierOrderItem[];
  scheduled: CashierOrderItem[];
}

/**
 * Order (item sent/preparing) untuk tab Orders kasir. Dua kelompok berdasar
 * STATUS SESI:
 *  - active    = sesi open/locked/overdue → "buat sekarang" (kasir teruskan ke
 *    dapur, bisa 'Tandai diproses').
 *  - scheduled = sesi reserved (booking, jam belum tiba) → dapur BELUM boleh
 *    buat; read-only (info saja).
 * FIFO (oldest first). Izin receive_payment (kasir), BUKAN view_queue.
 */
export async function getCashierOrderQueue(): Promise<CashierOrderQueue> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  const rows = await db
    .select({
      id: orderItems.id,
      order_id: orderItems.orderId,
      quantity: orderItems.quantity,
      notes: orderItems.notes,
      created_at: orderItems.createdAt,
      status: orderItems.status,
      menu_item_name: menuItems.name,
      menu_item_image: menuItems.imageUrl,
      added_by_name: profiles.displayName,
      added_by_avatar: profiles.avatarUrl,
      session_id: tableSessions.id,
      session_title: tableSessions.title,
      session_status: tableSessions.status,
      table_label: tables.label,
      area_name: floorAreas.name,
      reservation_at: tableSessions.reservationAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, orderItems.addedByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        inArray(orderItems.status, ["sent", "preparing"]),
        // Aktif ATAU booking terjadwal — dikelompokkan di bawah.
        inArray(tableSessions.status, [
          "open",
          "locked",
          "overdue",
          "reserved",
        ])
      )
    )
    .orderBy(asc(orderItems.createdAt));

  const active: CashierOrderItem[] = [];
  const scheduled: CashierOrderItem[] = [];
  for (const r of rows) {
    const item: CashierOrderItem = {
      id: r.id,
      order_id: r.order_id,
      quantity: r.quantity,
      notes: r.notes,
      created_at: r.created_at.toISOString(),
      status: r.status as "sent" | "preparing",
      menu_item_name: r.menu_item_name,
      menu_item_image: r.menu_item_image,
      added_by_name: r.added_by_name,
      added_by_avatar: r.added_by_avatar,
      session_id: r.session_id,
      session_title: r.session_title,
      table_label: r.table_label,
      area_name: r.area_name,
      reservation_at: r.reservation_at
        ? r.reservation_at.toISOString()
        : null,
    };
    if (r.session_status === "reserved") scheduled.push(item);
    else active.push(item);
  }
  return { active, scheduled };
}

/**
 * Kasir menandai item "sedang diproses" (sudah diteruskan ke dapur): sent →
 * preparing. Hanya untuk item di sesi AKTIF (open/locked/overdue) — order
 * booking terjadwal belum boleh diproses. Idempotent. Izin receive_payment.
 * Waiter tetap melihat item preparing (penanda "sedang dibuat") lalu menandai
 * served saat sudah diantar.
 */
export async function cashierMarkPreparing(itemId: string): Promise<void> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");

  const [item] = await db
    .select({
      id: orderItems.id,
      status: orderItems.status,
      session_id: tableSessions.id,
      session_status: tableSessions.status,
      table_label: tables.label,
      bar_id: floorAreas.barId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(orderItems.id, itemId));
  if (!item) throw new Error("Order item not found");
  if (item.bar_id !== ctx.barId) throw new Error("Invalid bar access");
  if (item.status === "preparing" || item.status === "served") {
    return; // idempotent (sudah diproses / diantar)
  }
  if (item.status !== "sent") {
    throw new Error("This item can't be marked as being prepared");
  }
  if (!["open", "locked", "overdue"].includes(item.session_status)) {
    // Booking terjadwal (reserved) belum boleh diproses.
    throw new Error("This order is scheduled, the kitchen shouldn't start it yet");
  }

  await db
    .update(orderItems)
    .set({ status: "preparing" })
    .where(and(eq(orderItems.id, itemId), eq(orderItems.status, "sent")));

  // Kabari sesi + staff (waiter melihat penanda "sedang dibuat").
  await notifyAll(item.session_id, ctx.barId, { type: "order.preparing" });

  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "order.preparing",
    category: "order",
    summary: `Proses order ke dapur — meja ${item.table_label}`,
    entityType: "order_item",
    entityId: itemId,
    meta: { sessionId: item.session_id, tableLabel: item.table_label },
  });

  revalidatePath("/staff/cashier");
  revalidatePath("/staff/waiter");
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
  /** "Pay at cashier": customer menunggu konfirmasi kasir (tanpa QR). */
  pay_at_cashier: boolean;
  /** Digantikan pembayaran lain yang menutup tagihan (tampil "Replaced"). */
  superseded: boolean;
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
  /** Label charge sesuai komponen aktif. */
  charge_label: string;
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

  // Multi-order: kasir melihat SEMUA order yang sudah "masuk" (paid/closed),
  // BUKAN order 'unpaid' (belum dibayar → belum masuk ke kasir/dapur).
  // PENGECUALIAN (Pay on Cashier): order 'unpaid' yang punya payment pending
  // "payAtCashier" HARUS tampil — customer sedang menunggu konfirmasi di
  // kasir; kasir perlu melihat item + tombol mark-paid utk mengonfirmasi.
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.sessionId, sessionId),
        sql`(
          ${orders.status} NOT IN ('unpaid', 'cancelled')
          OR (
            ${orders.status} = 'unpaid'
            AND EXISTS (
              SELECT 1 FROM ${payments} p
              WHERE p.order_id = ${orders.id}
                AND p.status = 'pending'
                AND (p.split_meta ->> 'payAtCashier')::boolean IS TRUE
            )
          )
        )`
      )
    )
    .orderBy(orders.createdAt);
  const orderIds = orderRows.map((o) => o.id);

  // Items (dari semua order yang masuk)
  const itemsRaw = orderIds.length
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
          and(inArray(orderItems.orderId, orderIds), ne(orderItems.status, "void"))
        )
        .orderBy(orderItems.createdAt)
    : [];

  // Payments (dari semua order yang masuk)
  const paymentsRaw = orderIds.length
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
        .where(inArray(payments.orderId, orderIds))
        .orderBy(payments.createdAt)
    : [];

  // Payment items (rincian item per pembayaran itemized) — untuk riwayat kasir.
  const paymentItemsRaw = orderIds.length
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
        .where(inArray(payments.orderId, orderIds))
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
    order_id: orderIds[orderIds.length - 1] ?? null,
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
        payAtCashier?: boolean;
        supersededByPaid?: boolean;
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
        pay_at_cashier: !!meta.payAtCashier,
        superseded: !!meta.supersededByPaid,
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
    charge_label: bill.chargeLabel,
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
  /** Multi-order: order spesifik yang dibayar. Fallback ke order non-unpaid terbaru. */
  orderId: z.string().uuid().optional(),
  payerMemberId: z.string().uuid(),
  amount: z.number().int().positive(),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
  /** Untuk cash: nominal yang diterima dari customer (untuk hitung kembalian) */
  cashReceived: z.number().int().positive().optional(),
  /** Kode voucher benefit membership (PRD Membership rev-2) — opsional. */
  voucherCode: z.string().trim().max(20).optional(),
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

  // 2. Order yang dibayar. Multi-order: pakai orderId kalau diberi (dicek milik
  //    sesi); else fallback ke order non-unpaid terbaru.
  let order: { id: string } | undefined;
  if (data.orderId) {
    const [byId] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, data.orderId), eq(orders.sessionId, data.sessionId)));
    order = byId;
  } else {
    const [latest] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.sessionId, data.sessionId),
          notInArray(orders.status, ["unpaid", "cancelled"])
        )
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    order = latest;
  }
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

  // 4b. Voucher benefit membership (kasir menginput kode milik customer di
  //     meja — pemiliknya harus member JOINED sesi ini). Divalidasi server.
  let voucher: { voucherId: string; code: string; discount: number } | null =
    null;
  if (data.voucherCode?.trim()) {
    const res = await resolveVoucherForBillPayment({
      code: data.voucherCode,
      sessionId: data.sessionId,
      amount: data.amount,
    });
    if (!res.ok) throw new Error(res.error);
    voucher = {
      voucherId: res.voucher.voucherId,
      code: res.voucher.code,
      discount: res.voucher.discount,
    };
  }
  const chargeAmount = data.amount - (voucher?.discount ?? 0);

  // Diskon menutup seluruh nominal → hanya baris voucher (paid), tanpa gateway.
  if (voucher && chargeAmount <= 0) {
    const [voucherPayment] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        paidByMemberId: data.payerMemberId,
        amount: voucher.discount,
        method: "voucher",
        status: "paid",
        splitMode: "equal" as SplitMode,
        splitMeta: { voucherCode: voucher.code, voucherId: voucher.voucherId },
        paidAt: new Date(),
      })
      .returning({ id: payments.id });
    const reserved = await reserveVoucherForPayment(
      voucher.voucherId,
      voucherPayment.id,
      voucher.discount
    );
    if (!reserved) {
      await db.delete(payments).where(eq(payments.id, voucherPayment.id));
      throw new Error("This voucher was just used. Try another one");
    }
    await settleVoucherForPayment(voucherPayment.id, { skipSyntheticRow: true });
    await settleOrderIfPaid(order.id);
    await settleOverdueIfPaid(data.sessionId);
    await notifyAll(data.sessionId, ctx.barId, { type: "payment.created" });
    revalidatePath(`/staff/cashier/${data.sessionId}`);
    revalidatePath("/staff/cashier");
    return {
      paymentId: voucherPayment.id,
      status: "paid" as const,
      externalRef: "",
      qrString: null,
      expiresAt: null,
      change: null,
    };
  }

  // 5. Insert payment row (status pending — gateway yang update). Nominal =
  //    SETELAH potongan voucher (baris diskon menyusul saat paid).
  const [newPayment] = await db
    .insert(payments)
    .values({
      orderId: order.id,
      paidByMemberId: data.payerMemberId,
      amount: chargeAmount,
      method: data.method,
      status: "pending",
      splitMode: "equal" as SplitMode,
      splitMeta: {
        cashReceived: data.cashReceived,
        change,
        ...(voucher
          ? { voucherCode: voucher.code, voucherDiscount: voucher.discount }
          : {}),
      },
      paidAt: null,
    })
    .returning({ id: payments.id });

  // Reservasi voucher (race-safe); kalah race → payment batal.
  if (voucher) {
    const reserved = await reserveVoucherForPayment(
      voucher.voucherId,
      newPayment.id,
      voucher.discount
    );
    if (!reserved) {
      await db
        .update(payments)
        .set({ status: "failed" })
        .where(eq(payments.id, newPayment.id));
      throw new Error("This voucher was just used. Try another one");
    }
  }

  // 6. Call gateway untuk create charge
  const gateway = getPaymentGateway();
  const chargeResult = await gateway.createCharge({
    paymentId: newPayment.id,
    amount: chargeAmount,
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

  // Gateway langsung paid (mock/cash) → settle voucher + order sekarang.
  if (chargeResult.status === "paid") {
    await settleVoucherForPayment(newPayment.id);
    await settleRevenueSplitForPayment(newPayment.id).catch((e) =>
      console.error("[split] cashierCreate:", e)
    );
    await settleOrderIfPaid(order.id);
    await settleOverdueIfPaid(data.sessionId);
  }

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
 * Konfirmasi payment pending "Pay at cashier" dengan PILIHAN metode aktual —
 * customer di meja kasir bisa bayar tunai ATAU minta QRIS (arahan user):
 * - cash → delegasi ke cashierMarkPaymentPaid (semua hook: dp_paid_at,
 *   settleOrderIfPaid, voucher, split, notif).
 * - qris → payment DIKONVERSI jadi tagihan QRIS di gateway (method 'qris',
 *   flag payAtCashier dilepas): mock → langsung paid via
 *   markPaymentPaidBySystem; Duitku → return qrString utk di-scan, lunas
 *   lewat callback/polling seperti QRIS biasa.
 */
export async function cashierConfirmPendingPayment(input: {
  paymentId: string;
  method: "cash" | "qris";
  /** Uang tunai diterima (utk catat kembalian) — hanya method cash. */
  cashReceived?: number;
}): Promise<{
  status: string;
  qrString: string | null;
  expiresAt: string | null;
  amount: number;
  change: number;
}> {
  const ctx = await requirePermission("receive_payment", "/staff/cashier");
  const data = z
    .object({
      paymentId: z.string().uuid(),
      method: z.enum(["cash", "qris"]),
      cashReceived: z.number().int().min(0).optional(),
    })
    .parse(input);

  const [payment] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      status: payments.status,
      splitMeta: payments.splitMeta,
      sessionId: orders.sessionId,
      barId: floorAreas.barId,
      payerName: profiles.displayName,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(eq(payments.id, data.paymentId));
  if (!payment) throw new Error("Payment not found");
  if (payment.barId !== ctx.barId) throw new Error("Invalid bar access");
  if (payment.status !== "pending") {
    throw new Error(
      "This payment is no longer pending (already confirmed, cancelled, or expired)"
    );
  }

  const change =
    data.method === "cash" && data.cashReceived != null
      ? Math.max(0, data.cashReceived - payment.amount)
      : 0;

  if (data.method === "cash") {
    // Catat uang diterima + kembalian di splitMeta (utk struk) sebelum settle,
    // SEKALIGUS lepas flag payAtCashier — pembayarannya sudah dikonfirmasi,
    // jadi metodenya kini benar-benar 'cash'. Tanpa ini label di detail order
    // menempel "PAY AT CASHIER" selamanya walau barisnya sudah Paid (cabang
    // QRIS sudah melepasnya; cabang cash terlewat).
    // WAJIB tanpa syarat cashReceived — dulu update ini hanya jalan kalau
    // nominal tunai diisi, sehingga konfirmasi tanpa nominal meninggalkan flag.
    const meta0 = (payment.splitMeta as Record<string, unknown> | null) ?? {};
    const { payAtCashier: _dropped, ...restMeta } = meta0;
    void _dropped;
    await db
      .update(payments)
      .set({
        splitMeta:
          data.cashReceived != null
            ? { ...restMeta, cashReceived: data.cashReceived, change }
            : restMeta,
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
    await cashierMarkPaymentPaid(payment.id);
    return {
      status: "paid",
      qrString: null,
      expiresAt: null,
      amount: payment.amount,
      change,
    };
  }

  // QRIS di meja kasir: konversi payment jadi charge gateway.
  const meta =
    (payment.splitMeta as Record<string, unknown> | null) ?? {};
  const { payAtCashier: _dropped, ...restMeta } = meta;
  void _dropped;
  const gateway = getPaymentGateway();
  const cr = await gateway.createCharge({
    paymentId: payment.id,
    amount: payment.amount,
    method: "qris",
    payerName: payment.payerName,
    description: `Cashier QRIS - ${payment.sessionId.slice(0, 8)}`,
  });

  // Update conditional (WHERE pending) — jangan menimpa payment yang keburu
  // berubah status di sela panggilan gateway.
  const updated = await db
    .update(payments)
    .set({
      method: "qris",
      externalRef: cr.externalRef,
      splitMeta: {
        ...restMeta,
        qrString: cr.qrString ?? null,
        redirectUrl: cr.redirectUrl ?? null,
        expiresAt: cr.expiresAt ?? null,
        merchantOrderId: cr.merchantOrderId ?? payment.id,
      },
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")))
    .returning({ id: payments.id });
  if (updated.length === 0) {
    throw new Error("This payment just changed state. Refresh and try again");
  }

  if (cr.status === "paid") {
    // Mock gateway: langsung lunas → jalankan SEMUA hook via jalur sistem
    // (dp_paid_at, settleOrderIfPaid, voucher, split, notif) — idempotent.
    await markPaymentPaidBySystem(payment.id);
    return {
      status: "paid",
      qrString: cr.qrString ?? null,
      expiresAt: null,
      amount: payment.amount,
      change: 0,
    };
  }

  revalidatePath(`/staff/cashier/${payment.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath(`/session/${payment.sessionId}`);
  return {
    status: cr.status,
    qrString: cr.qrString ?? null,
    expiresAt: cr.expiresAt ?? null,
    amount: payment.amount,
    change: 0,
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
      orderId: payments.orderId,
      splitMeta: payments.splitMeta,
      amount: payments.amount,
      method: payments.method,
      sessionId: orders.sessionId,
      tableLabel: tables.label,
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

  // Nama kasir yang memproses → dicatat di splitMeta (untuk payment history).
  const [cashier] = await db
    .select({ name: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, ctx.profileId));
  const prevMeta = (payment.splitMeta as Record<string, unknown> | null) ?? {};

  // Transisi conditional pending→paid: kalau payment keburu expired/dibatalkan
  // (mis. DP pay-at-cashier lewat 10 menit → booking sudah cancelled), JANGAN
  // menghidupkan lagi — kasir dapat error yang jelas.
  const updated = await db
    .update(payments)
    .set({
      status: "paid",
      paidAt: new Date(),
      splitMeta: { ...prevMeta, confirmedByName: cashier?.name ?? null },
    })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
    .returning({ id: payments.id });
  if (updated.length === 0) {
    throw new Error(
      "This payment is no longer pending (already confirmed, cancelled, or expired)"
    );
  }

  // Voucher membership yang menempel → tandai used + baris diskon (idempotent).
  await settleVoucherForPayment(paymentId);
  await settleRevenueSplitForPayment(paymentId).catch((e) =>
    console.error("[split] cashierMarkPaid:", e)
  );

  // DP booking dikonfirmasi → tandai dp_paid_at (booking sah; reservasi bisa
  // dipromote saat waktunya).
  const meta = (payment.splitMeta as { isDownPayment?: boolean } | null) ?? {};
  if (meta.isDownPayment) {
    // Guard transisi null→terisi → undangan booking hanya sekali (baru dikirim
    // ke user diundang setelah DP lunas, bukan saat booking dibuat).
    const dpSet = await db
      .update(tableSessions)
      .set({ dpPaidAt: new Date() })
      .where(
        and(
          eq(tableSessions.id, payment.sessionId),
          isNull(tableSessions.dpPaidAt)
        )
      )
      .returning({ id: tableSessions.id });
    if (dpSet.length > 0) {
      await sendBookingInvites(payment.sessionId).catch((e) =>
        console.error("[invite] cashierMarkPaymentPaid:", e)
      );
    }
  }

  // Prepaid hook: order 'unpaid' yang kini terbayar → MASUK dapur
  // (status 'paid' + item draft→sent → tampil di antrean waiter).
  await settleOrderIfPaid(payment.orderId);

  // Sesi 'overdue' yang kini lunas → tutup otomatis.
  await settleOverdueIfPaid(payment.sessionId);

  await notifyAll(payment.sessionId, ctx.barId, { type: "payment.paid" });
  // Notif in-app + push ke host/pembayar (konsisten dgn jalur webhook/polling).
  await notifyPaymentEvent(
    paymentId,
    meta.isDownPayment ? "dp_confirmed" : "paid"
  );

  // Audit: kasir mana yang mengonfirmasi pembayaran ini.
  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: meta.isDownPayment ? "payment.dp_confirmed" : "payment.received",
    category: "payment",
    summary: `${meta.isDownPayment ? "Konfirmasi DP" : "Terima pembayaran"} ${formatIDR(payment.amount)} meja ${payment.tableLabel}`,
    entityType: "payment",
    entityId: paymentId,
    meta: {
      amount: payment.amount,
      method: payment.method,
      sessionId: payment.sessionId,
      tableLabel: payment.tableLabel,
    },
  });

  revalidatePath(`/staff/cashier/${payment.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath(`/session/${payment.sessionId}`);
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
      amount: payments.amount,
      sessionId: orders.sessionId,
      tableLabel: tables.label,
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
  await releaseVoucherForPayment(paymentId);

  await notifyAll(payment.sessionId, ctx.barId, { type: "payment.cancelled" });
  await notifyPaymentEvent(paymentId, "cancelled");

  // Audit: pembatalan pembayaran = aksi sensitif, wajib tercatat.
  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "payment.cancelled",
    category: "payment",
    summary: `Batalkan pembayaran ${formatIDR(payment.amount)} meja ${payment.tableLabel}`,
    entityType: "payment",
    entityId: paymentId,
    meta: {
      amount: payment.amount,
      sessionId: payment.sessionId,
      tableLabel: payment.tableLabel,
    },
  });

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
      orderId: payments.orderId,
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

  // Payment yang sudah kita matikan ('failed') ternyata TETAP dibayar di
  // gateway (QRIS lama masih hidup di sisi Duitku sampai expiry-nya sendiri,
  // mis. dibayar tepat saat host menerbitkan QRIS pengganti).
  // Uangnya nyata → tetap catat 'paid' (menolak = uang masuk tapi tak tercatat,
  // lebih buruk). TAPI jangan senyap: tandai sebagai pembayaran tak terduga &
  // kabari staff supaya kelebihan bayar bisa ditangani.
  const wasFailed = payment.status === "failed";
  const prevMeta =
    (payment.splitMeta as Record<string, unknown> | null) ?? {};

  await db
    .update(payments)
    .set({
      status: "paid",
      paidAt: new Date(),
      ...(wasFailed
        ? { splitMeta: { ...prevMeta, paidAfterCancelled: true } }
        : {}),
    })
    .where(eq(payments.id, paymentId));

  // DP booking lunas → tandai dp_paid_at (booking terkonfirmasi).
  const meta =
    (payment.splitMeta as { isDownPayment?: boolean } | null) ?? {};
  if (meta.isDownPayment) {
    // Guard transisi null→terisi → undangan booking hanya sekali (webhook bisa
    // dipanggil berkali-kali; undangan baru dikirim setelah DP lunas).
    const dpSet = await db
      .update(tableSessions)
      .set({ dpPaidAt: new Date() })
      .where(
        and(
          eq(tableSessions.id, payment.sessionId),
          isNull(tableSessions.dpPaidAt)
        )
      )
      .returning({ id: tableSessions.id });
    if (dpSet.length > 0) {
      await sendBookingInvites(payment.sessionId).catch((e) =>
        console.error("[invite] markPaymentPaidBySystem:", e)
      );
    }
  }

  // Voucher membership yang menempel → tandai used + baris diskon (idempotent).
  await settleVoucherForPayment(payment.id);
  await settleRevenueSplitForPayment(payment.id).catch((e) =>
    console.error("[split] webhook:", e)
  );

  // Prepaid hook: kalau order 'unpaid' & kini ada pembayaran lunas → order MASUK
  // (status 'paid' + item draft→sent). (PRD Multi-Order Prepaid.)
  await settleOrderIfPaid(payment.orderId);
  await settleOverdueIfPaid(payment.sessionId);
  await notifyAll(payment.sessionId, payment.barId, { type: "payment.paid" });
  // Notif in-app + push ke host/pembayar/staff.
  await notifyPaymentEvent(payment.id, meta.isDownPayment ? "dp_confirmed" : "paid");

  // Pembayaran masuk untuk transaksi yang sudah dibatalkan → berpotensi LEBIH
  // BAYAR (mis. QRIS penggantinya juga dibayar). Kabari staff aktif di bar biar
  // bisa dicek/di-refund, jangan sampai lolos senyap.
  if (wasFailed) {
    const staff = await db
      .select({ profileId: staffRoles.profileId })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.barId, payment.barId), eq(staffRoles.isActive, true))
      );
    await Promise.allSettled(
      staff.map((s) =>
        createNotification({
          profileId: s.profileId,
          type: "general",
          title: "Payment received on a cancelled transaction",
          body: "A cancelled QRIS was still paid. Check the bill for a possible overpayment.",
          link: `/session/${payment.sessionId}`,
        })
      )
    );
  }

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
    .select({
      bar_id: floorAreas.barId,
      status: tableSessions.status,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.bar_id !== ctx.barId) throw new Error("Invalid bar access");
  if (row.status === "closed") throw new Error("Table is already closed");

  // Order yang masih 'unpaid' saat meja ditutup (mis. order pribadi anggota yg
  // tak jadi dibayar): void itemnya & matikan pembayaran pending-nya. Tanpa ini
  // itemnya tetap terhitung sebagai tagihan hantu, dan QRIS-nya masih hidup di
  // gateway — kalau anggota terlanjur bayar, uangnya masuk ke order tertutup
  // tanpa item. (Pola sama dgn closeSession sisi host.)
  const unpaidOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, sessionId), eq(orders.status, "unpaid")));
  if (unpaidOrders.length > 0) {
    const ids = unpaidOrders.map((o) => o.id);
    await db
      .update(orderItems)
      .set({ status: "void" })
      .where(inArray(orderItems.orderId, ids));
    await db
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(
        and(inArray(payments.orderId, ids), eq(payments.status, "pending"))
      );
  }

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

  // Audit: siapa yang menutup meja (sebelumnya tak tercatat sama sekali).
  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "session.closed",
    category: "session",
    summary: `Tutup meja ${row.table_label}`,
    entityType: "session",
    entityId: sessionId,
    meta: { tableLabel: row.table_label, voidedOrders: unpaidOrders.length },
  });

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
        // Jangan hitung uang dari order unpaid/cancelled (mis. race cancel vs
        // paid) — supaya revenue shift & rekonsiliasi kas tetap benar.
        notInArray(orders.status, ["unpaid", "cancelled"]),
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
    .where(
      and(
        inArray(orders.sessionId, sessionIds),
        notInArray(orders.status, ["unpaid", "cancelled"])
      )
    )
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
