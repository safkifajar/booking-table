"use server";

/**
 * Server Actions untuk Waiter dashboard.
 *
 * Operations:
 * - getOrderQueueForWaiter: list order item status='sent' dari semua meja aktif
 * - getActiveSessionsForWaiter: list meja aktif dengan info untuk bantu pesan
 * - waiterMarkServed: mark order item sebagai served
 * - waiterJoinSession: insert waiter sebagai session member (untuk bantu pesan)
 *
 * Semua action butuh permission yang sesuai (view_queue / assist_order / update_order_status).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { staffRoles } from "@/lib/db/schema/extras";
import { users } from "@/lib/db/schema/auth";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { menuItems, menuCategories } from "@/lib/db/schema/menu";
import { requirePermission, can } from "@/lib/auth-v2/permissions";
import { cashierMarkPaymentPaid } from "@/lib/cashier-actions";
import { sortUnpaidFirst } from "@/lib/session-sort";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import { isDbConstraintError } from "@/lib/utils";
import { getPaymentGateway } from "@/lib/payments/gateway";
import { getChargeConfig } from "@/lib/settings-actions";
import { computeBillTotals } from "@/lib/settings-constants";
import { notifyCashiersPayAtCashier } from "@/lib/payment-notify";
import { memberVouchers } from "@/lib/db/schema/membership-transactions";
import {
  resolveVoucherForBillPayment,
  settleVoucherForPayment,
  releaseVoucherForPayment,
} from "@/lib/member-voucher";
import { logActivity } from "@/lib/activity-log";
import {
  settleOrderIfPaid,
  settleOverdueIfPaid,
  DP_TIMEOUT_SECONDS,
  PAY_AT_CASHIER_TIMEOUT_SECONDS,
} from "@/lib/queries";
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";
import {
  generateAvailableSlots,
  getBookedSlotIsos,
  type AvailableSlot,
  type BookedRange,
} from "@/lib/reservation-helpers";
import crypto from "node:crypto";

/**
 * Penanda internal: voucher kalah balapan saat dikunci di dalam transaksi
 * buka-meja. Dipakai utk membedakannya dari error DB lain di catch, lalu
 * diubah jadi pesan yang ramah. Sengaja konstanta lokal (file "use server"
 * hanya boleh mengekspor fungsi async).
 */
const VOUCHER_RACE_LOST = "__voucher_race_lost__";

// ============================================================
// ORDER QUEUE
// ============================================================

export interface WaiterQueueItem {
  id: string;
  order_id: string;
  quantity: number;
  notes: string | null;
  created_at: string;
  /** 'sent' = baru masuk; 'preparing' = kasir sudah teruskan (dapur sedang
   *  buat) → waiter tinggal tunggu & antar; 'served' = sudah diantar (tab
   *  Served Today). */
  status: "sent" | "preparing" | "served";
  menu_item_name: string;
  menu_item_image: string | null;
  added_by_name: string;
  added_by_avatar: string | null;
  table_label: string;
  area_name: string;
  session_id: string;
  session_title: string | null;
}

/**
 * Order item yang baru di-pesan customer (status='sent') dari semua meja
 * aktif di bar. Sorted oldest first (FIFO — antar yang paling lama dulu).
 */
export async function getOrderQueueForWaiter(): Promise<WaiterQueueItem[]> {
  const ctx = await requirePermission("view_queue", "/staff/waiter");

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
      table_label: tables.label,
      area_name: floorAreas.name,
      session_id: tableSessions.id,
      session_title: tableSessions.title,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .innerJoin(
      sessionMembers,
      eq(sessionMembers.id, orderItems.addedByMemberId)
    )
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        // 'preparing' ikut tampil — kasir sudah teruskan ke dapur; waiter beri
        // penanda "sedang dibuat" lalu antar. FIFO tetap oldest-first.
        inArray(orderItems.status, ["sent", "preparing"]),
        inArray(tableSessions.status, ["open", "locked", "overdue"])
      )
    )
    .orderBy(asc(orderItems.createdAt));

  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    notes: r.notes,
    created_at: r.created_at.toISOString(),
    order_id: r.order_id,
    status: r.status as "sent" | "preparing",
    menu_item_name: r.menu_item_name,
    menu_item_image: r.menu_item_image,
    added_by_name: r.added_by_name,
    added_by_avatar: r.added_by_avatar,
    table_label: r.table_label,
    area_name: r.area_name,
    session_id: r.session_id,
    session_title: r.session_title,
  }));
}

export interface WaiterServedItem extends WaiterQueueItem {
  /** Kapan diantar (ISO). */
  served_at: string;
}

/**
 * Item yang SUDAH diantar HARI INI (status='served') — utk tab monitor
 * "sudah dikirim semua atau belum". Terbaru dulu. Sesi yang sudah closed
 * tetap ikut (yang dipantau pengantaran hari ini, bukan status meja).
 */
export async function getServedItemsForWaiter(): Promise<WaiterServedItem[]> {
  const ctx = await requirePermission("view_queue", "/staff/waiter");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      id: orderItems.id,
      order_id: orderItems.orderId,
      quantity: orderItems.quantity,
      notes: orderItems.notes,
      created_at: orderItems.createdAt,
      served_at: orderItems.servedAt,
      menu_item_name: menuItems.name,
      menu_item_image: menuItems.imageUrl,
      added_by_name: profiles.displayName,
      added_by_avatar: profiles.avatarUrl,
      table_label: tables.label,
      area_name: floorAreas.name,
      session_id: tableSessions.id,
      session_title: tableSessions.title,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .innerJoin(
      sessionMembers,
      eq(sessionMembers.id, orderItems.addedByMemberId)
    )
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        eq(orderItems.status, "served"),
        // gte() typed — JANGAN sql template mentah utk Date: param-nya
        // di-stringify jadi format JS yang ditolak Postgres.
        gte(orderItems.servedAt, startOfDay)
      )
    )
    .orderBy(desc(orderItems.servedAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    notes: r.notes,
    created_at: r.created_at.toISOString(),
    order_id: r.order_id,
    status: "served" as const,
    served_at: (r.served_at ?? r.created_at).toISOString(),
    menu_item_name: r.menu_item_name,
    menu_item_image: r.menu_item_image,
    added_by_name: r.added_by_name,
    added_by_avatar: r.added_by_avatar,
    table_label: r.table_label,
    area_name: r.area_name,
    session_id: r.session_id,
    session_title: r.session_title,
  }));
}

// ============================================================
// ACTIVE SESSIONS (untuk tab "Meja Aktif")
// ============================================================

export interface WaiterSessionItem {
  session_id: string;
  table_label: string;
  area_name: string;
  title: string | null;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  /** Berapa anggota yang PELANGGAN TERDAFTAR (sisanya tamu walk-in). */
  registered_count: number;
  table_capacity: number;
  started_at: string;
  reservation_at: string | null;
  reservation_end_at: string | null;
  status: string;
  subtotal: number;
  paid_total: number;
  outstanding: number;
  is_paid: boolean;
  item_count: number;
}

export async function getActiveSessionsForWaiter(): Promise<WaiterSessionItem[]> {
  const ctx = await requirePermission("view_queue", "/staff/waiter");

  // Sessions aktif di bar
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
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      status: tableSessions.status,
      table_capacity: tables.capacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        inArray(tableSessions.status, ["open", "locked", "overdue"]),
        // Jaring pengaman DISPLAY: walau expireFinishedSessions harusnya sudah
        // menutup sesi lewat-waktu, jangan pernah tampilkan sesi yang JELAS
        // sudah usai — reservation_end_at sudah lewat, ATAU sesi (apa pun)
        // dimulai > 12 jam lalu. Reservasi masa depan (end di masa depan) &
        // sesi baru tetap tampil.
        sql`(
          (${tableSessions.reservationEndAt} IS NULL OR ${tableSessions.reservationEndAt} > now())
          AND ${tableSessions.startedAt} > now() - interval '12 hours'
        )`,
        // Sembunyikan meja yang HANYA "open" karena menunggu pembayaran
        // pay-at-cashier & belum punya order yang benar-benar masuk (paid).
        // Baru tampil ke waiter setelah ada order masuk / DP terkonfirmasi.
        // (Meja tanpa pending pay-at-cashier tetap tampil seperti biasa.)
        sql`(
          NOT EXISTS (
            SELECT 1 FROM ${orders} o
            JOIN ${payments} p ON p.order_id = o.id
            WHERE o.session_id = ${tableSessions.id}
              AND p.status = 'pending'
              AND (p.split_meta ->> 'payAtCashier')::boolean IS TRUE
          )
          OR EXISTS (
            SELECT 1 FROM ${orders} o2
            WHERE o2.session_id = ${tableSessions.id}
              AND o2.status NOT IN ('unpaid', 'cancelled')
          )
        )`
      )
    )
    .orderBy(asc(tableSessions.startedAt));

  if (sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((s) => s.id);

  // Bill aggregate (subtotal + item count). Exclude order unpaid (belum dibayar)
  // & cancelled (dibatalkan customer) — belum "masuk" ke waiter.
  const bills = await db
    .select({
      session_id: orders.sessionId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
      item_count: sql<number>`COUNT(${orderItems.id})::int`,
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
  const billMap = new Map(bills.map((b) => [b.session_id, b]));

  // Paid aggregate per session (sum payments yang status=paid)
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
        // Konsisten dgn subtotal: payment milik order unpaid/cancelled tak dihitung.
        notInArray(orders.status, ["unpaid", "cancelled"])
      )
    )
    .groupBy(orders.sessionId);
  const paidMap = new Map(paidRows.map((p) => [p.session_id, Number(p.paid)]));

  // Member count
  const memberCountRows = await db
    .select({
      session_id: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`,
      // Berapa yang PELANGGAN TERDAFTAR (sisanya tamu walk-in). Dihitung di
      // query yang sama, tanpa round-trip tambahan.
      registered: sql<number>`COUNT(*) FILTER (WHERE ${profiles.isGuest} = false)::int`,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
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
  const registeredMap = new Map(
    memberCountRows.map((m) => [m.session_id, Number(m.registered)])
  );

  const rows = sessionRows.map((s) => {
    const subtotal = Number(billMap.get(s.id)?.subtotal ?? 0);
    const paid = paidMap.get(s.id) ?? 0;
    return {
      session_id: s.id,
      table_label: s.table_label,
      area_name: s.area_name,
      title: s.title,
      host_name: s.host_name,
      host_avatar: s.host_avatar,
      member_count: memberMap.get(s.id) ?? 0,
      registered_count: registeredMap.get(s.id) ?? 0,
      table_capacity: s.table_capacity,
      started_at: s.started_at.toISOString(),
      reservation_at: s.reservation_at ? s.reservation_at.toISOString() : null,
      reservation_end_at: s.reservation_end_at
        ? s.reservation_end_at.toISOString()
        : null,
      status: s.status,
      subtotal,
      paid_total: paid,
      outstanding: Math.max(0, subtotal - paid),
      is_paid: subtotal > 0 && paid >= subtotal,
      item_count: Number(billMap.get(s.id)?.item_count ?? 0),
    };
  });

  return sortUnpaidFirst(rows);
}

/**
 * Sesi yang sudah SELESAI (closed) di bar — untuk tab "Selesai" di dashboard.
 * Terbaru dulu, dibatasi 50. Bentuk data = WaiterSessionItem (reuse kartu).
 */
export async function getClosedSessionsForWaiter(): Promise<WaiterSessionItem[]> {
  const ctx = await requirePermission("view_queue", "/staff/waiter");

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
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      status: tableSessions.status,
      table_capacity: tables.capacity,
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
      item_count: sql<number>`COUNT(${orderItems.id})::int`,
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
  const billMap = new Map(bills.map((b) => [b.session_id, b]));

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
        // Konsisten dgn subtotal: payment milik order unpaid/cancelled tak dihitung.
        notInArray(orders.status, ["unpaid", "cancelled"])
      )
    )
    .groupBy(orders.sessionId);
  const paidMap = new Map(paidRows.map((p) => [p.session_id, Number(p.paid)]));

  const memberCountRows = await db
    .select({
      session_id: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`,
      // Berapa yang PELANGGAN TERDAFTAR (sisanya tamu walk-in). Dihitung di
      // query yang sama, tanpa round-trip tambahan.
      registered: sql<number>`COUNT(*) FILTER (WHERE ${profiles.isGuest} = false)::int`,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
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
  const registeredMap = new Map(
    memberCountRows.map((m) => [m.session_id, Number(m.registered)])
  );

  const rows = sessionRows.map((s) => {
    const subtotal = Number(billMap.get(s.id)?.subtotal ?? 0);
    const paid = paidMap.get(s.id) ?? 0;
    return {
      session_id: s.id,
      table_label: s.table_label,
      area_name: s.area_name,
      title: s.title,
      host_name: s.host_name,
      host_avatar: s.host_avatar,
      member_count: memberMap.get(s.id) ?? 0,
      registered_count: registeredMap.get(s.id) ?? 0,
      table_capacity: s.table_capacity,
      started_at: s.started_at.toISOString(),
      reservation_at: s.reservation_at ? s.reservation_at.toISOString() : null,
      reservation_end_at: s.reservation_end_at
        ? s.reservation_end_at.toISOString()
        : null,
      status: s.status,
      subtotal,
      paid_total: paid,
      outstanding: Math.max(0, subtotal - paid),
      is_paid: subtotal > 0 && paid >= subtotal,
      item_count: Number(billMap.get(s.id)?.item_count ?? 0),
    };
  });

  return sortUnpaidFirst(rows);
}

// ============================================================
// BOOKINGS (untuk tab "Booking" — reservasi terjadwal, blm mulai)
// ============================================================

export interface WaiterBookingItem {
  session_id: string;
  table_label: string;
  area_name: string;
  title: string | null;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  /** Berapa anggota yang PELANGGAN TERDAFTAR (sisanya tamu walk-in). */
  registered_count: number;
  table_capacity: number;
  reservation_at: string;
  reservation_end_at: string | null;
}

/**
 * Daftar reservasi TERJADWAL (status 'reserved', jamnya belum tiba) di bar.
 * Untuk tab "Booking" waiter — supaya tahu meja apa di-booking jam berapa.
 * Urut by reservation_at (terdekat dulu).
 */
export async function getBookingsForWaiter(): Promise<WaiterBookingItem[]> {
  const ctx = await requirePermission("view_queue", "/staff/waiter");

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
        eq(tableSessions.status, "reserved"),
        // Booking yang DP-nya BELUM dikonfirmasi (mis. pay-at-cashier menunggu
        // kasir) belum terkonfirmasi → JANGAN tampil ke waiter. Baru muncul
        // setelah dp_paid_at terisi (kasir konfirmasi) — arahan produk.
        sql`(
          ${tableSessions.dpPaidAt} IS NOT NULL
          OR NOT EXISTS (
            SELECT 1 FROM ${orders} o
            JOIN ${payments} p ON p.order_id = o.id
            WHERE o.session_id = ${tableSessions.id}
              AND p.status = 'pending'
              AND (p.split_meta ->> 'isDownPayment')::boolean IS TRUE
          )
        )`
      )
    )
    .orderBy(asc(tableSessions.reservationAt));

  if (rows.length === 0) return [];

  // Member count joined per sesi.
  const ids = rows.map((r) => r.id);
  const memberRows = await db
    .select({
      session_id: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`,
      registered: sql<number>`COUNT(*) FILTER (WHERE ${profiles.isGuest} = false)::int`,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        inArray(sessionMembers.sessionId, ids),
        eq(sessionMembers.status, "joined")
      )
    )
    .groupBy(sessionMembers.sessionId);
  const memberMap = new Map(memberRows.map((m) => [m.session_id, Number(m.count)]));
  const registeredMap = new Map(
    memberRows.map((m) => [m.session_id, Number(m.registered)])
  );

  return rows.map((r) => ({
    session_id: r.id,
    table_label: r.table_label,
    area_name: r.area_name,
    title: r.title,
    host_name: r.host_name,
    host_avatar: r.host_avatar,
    member_count: memberMap.get(r.id) ?? 0,
    registered_count: registeredMap.get(r.id) ?? 0,
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
// MARK SERVED
// ============================================================

/**
 * Mark order item sebagai served (sudah diantar ke meja).
 * Skip status preparing — langsung sent → served.
 */
export async function waiterMarkServed(itemId: string): Promise<void> {
  const ctx = await requirePermission("update_order_status", "/staff/waiter");

  // Verify item exists & di bar yang sama
  const [item] = await db
    .select({
      id: orderItems.id,
      order_id: orderItems.orderId,
      session_id: tableSessions.id,
      table_label: tables.label,
      bar_id: floorAreas.barId,
      current_status: orderItems.status,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(orderItems.id, itemId));

  if (!item) throw new Error("Order item not found");
  if (item.bar_id !== ctx.barId) throw new Error("Invalid bar access");
  if (item.current_status === "served") {
    return; // Idempotent — sudah served
  }
  if (item.current_status === "void") {
    throw new Error("This item has already been voided");
  }

  await db
    .update(orderItems)
    .set({ status: "served", servedAt: new Date() })
    .where(eq(orderItems.id, itemId));

  await notify(channels.session(item.session_id), { type: "order.served" });
  await notify(channels.staff(ctx.barId), { type: "order.served" });
  await notify(channels.bar(ctx.barId), { type: "order.served" });

  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "order.served",
    category: "order",
    summary: `Served order at table ${item.table_label}`,
    entityType: "order_item",
    entityId: itemId,
    meta: { sessionId: item.session_id, tableLabel: item.table_label },
  });

  revalidatePath("/staff/waiter");
}

// ============================================================
// JOIN SESSION (Bantu Pesan)
// ============================================================

/**
 * Waiter join session sebagai member supaya bisa add order item atas nama
 * customer. Idempotent — kalau sudah joined, skip insert.
 *
 * Setelah join, redirect ke /session/[id] (UI customer) supaya waiter
 * bisa pakai cart UI standar untuk bantu pesan.
 */
export async function waiterJoinSession(sessionId: string): Promise<void> {
  const ctx = await requirePermission("assist_order", "/staff/waiter");

  // Validate session ada & status open di bar yang sama
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      bar_id: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  if (!row) throw new Error("Session not found");
  if (row.bar_id !== ctx.barId) throw new Error("Invalid bar access");
  if (row.status !== "open") {
    throw new Error("Session is no longer open, cannot assist with ordering");
  }

  // Waiter TIDAK insert sebagai member meja. Konsep: staff = operator, bukan
  // customer. Session view (page customer) akan detect staffRole dari session
  // lookup dan grant interact rights (pesan, view bill) tanpa harus jadi member.
  // Order item yang waiter input akan attributed ke member meja yang dia pilih
  // di picker "Pesan untuk: [member]", dengan input_by_staff_id = waiter
  // sebagai audit trail.
  //
  // Edge case: kalau waiter sebelumnya pernah jadi member (mis. sebelum
  // refactor ini), set status=left supaya gak muncul di member list.
  const [existing] = await db
    .select({ id: sessionMembers.id, status: sessionMembers.status })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, ctx.profileId),
        eq(sessionMembers.status, "joined")
      )
    );
  if (existing) {
    await db
      .update(sessionMembers)
      .set({ status: "left", leftAt: new Date() })
      .where(eq(sessionMembers.id, existing.id));
    await notify(channels.session(sessionId), { type: "member.left" });
    await notify(channels.staff(ctx.barId), { type: "member.left" });
    await notify(channels.bar(ctx.barId), { type: "member.left" });
  }

  revalidatePath("/staff/waiter");
  redirect(`/session/${sessionId}`);
}

// ============================================================
// OPEN TABLE FOR CUSTOMER (Walk-in tanpa HP)
// ============================================================

export interface AvailableTable {
  id: string;
  label: string;
  area_name: string;
  capacity: number;
}

/**
 * List meja yang tersedia (belum ada session aktif) di bar.
 * Dipakai untuk modal "Buka Meja Baru" — waiter pilih meja kosong.
 */
export async function getAvailableTablesForWaiter(): Promise<AvailableTable[]> {
  const ctx = await requirePermission("open_table_for_customer", "/staff/waiter");

  // TAMPILKAN SEMUA meja aktif (tidak meng-exclude meja yg sedang dipakai).
  // Satu meja bisa sedang punya sesi aktif TAPI masih punya slot jam lain yg
  // bebas (mis. open 19:00–21:00, tapi 22:00 ke atas kosong). Slot mana yg
  // booked ditentukan PER-JAM oleh picker (getReservationDataForWaiter →
  // bookedByTable), bukan dgn menyembunyikan mejanya.
  const rows = await db
    .select({
      id: tables.id,
      label: tables.label,
      area_name: floorAreas.name,
      capacity: tables.capacity,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(and(eq(floorAreas.barId, ctx.barId), eq(tables.isActive, true)))
    .orderBy(asc(floorAreas.sortOrder), asc(tables.label));

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    area_name: r.area_name,
    capacity: r.capacity,
  }));
}

export interface WaiterReservationData {
  slots: AvailableSlot[];
  slotIntervalMinutes: number;
  bookingWindowDays: number;
  enabled: boolean;
  /** ISO slot ter-booking per tableId (utk picker per meja). */
  bookedByTable: Record<string, string[]>;
}

/**
 * Data slot reservasi untuk waiter open table: slot bar + booked per meja.
 * Picker waiter pilih meja → pakai bookedByTable[tableId].
 */
export async function getReservationDataForWaiter(): Promise<WaiterReservationData> {
  const ctx = await requirePermission("open_table_for_customer", "/staff/waiter");

  const [barRow] = await db
    .select({
      opening_hours: bars.openingHours,
      reservation_config: bars.reservationConfig,
    })
    .from(bars)
    .where(eq(bars.id, ctx.barId));

  const opHours: OperatingHours = {
    ...DEFAULT_OPERATING_HOURS,
    ...((barRow?.opening_hours as OperatingHours) ?? {}),
  };
  const resConfig: ReservationConfig = {
    ...DEFAULT_RESERVATION_CONFIG,
    ...((barRow?.reservation_config as Partial<ReservationConfig>) ?? {}),
  };

  const now = new Date();
  const slots = resConfig.enabled
    ? generateAvailableSlots(now, resConfig, opHours)
    : [];

  const bookedByTable: Record<string, string[]> = {};
  if (resConfig.enabled && slots.length > 0) {
    // Reservasi aktif (reserved/open/locked) seluruh meja di bar.
    const rows = await db
      .select({
        tableId: tableSessions.tableId,
        startAt: tableSessions.reservationAt,
        endAt: tableSessions.reservationEndAt,
      })
      .from(tableSessions)
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
      .where(
        and(
          eq(floorAreas.barId, ctx.barId),
          inArray(tableSessions.status, ["reserved", "open", "locked"])
        )
      );
    const rangesByTable: Record<string, BookedRange[]> = {};
    for (const r of rows) {
      if (!r.startAt || !r.endAt || r.endAt.getTime() <= now.getTime()) continue;
      (rangesByTable[r.tableId] ??= []).push({
        startMs: r.startAt.getTime(),
        endMs: r.endAt.getTime(),
      });
    }
    for (const [tableId, ranges] of Object.entries(rangesByTable)) {
      bookedByTable[tableId] = Array.from(getBookedSlotIsos(slots, ranges));
    }
  }

  return {
    slots,
    slotIntervalMinutes: resConfig.slotIntervalMinutes,
    bookingWindowDays: resConfig.bookingWindowDays,
    enabled: resConfig.enabled,
    bookedByTable,
  };
}

/**
 * Waiter buka meja untuk customer walk-in (yang tidak bawa HP).
 *
 * Konsep: customer adalah "yang punya bill", staff adalah "yang nge-handle".
 * Untuk walk-in tanpa akun, kita bikin GUEST PROFILE (placeholder, is_guest=true)
 * pakai nama tamu utama. Guest jadi host session. Waiter join sebagai member
 * biasa supaya bisa add order item atas nama tamu.
 *
 * Flow:
 * 1. Validate table aktif & belum ada session
 * 2. Create users row dengan fake email (passwordHash NULL = can't login)
 * 3. Create profiles row dengan displayName = nama tamu utama, is_guest=true
 * 4. Insert session dengan host = guest profile, opened_by_staff_id = waiter
 * 5. Insert dua session_members: guest (host) + waiter (member)
 * 6. Insert empty order
 * 7. Insert invite code (by waiter)
 * 8. Redirect ke /session/[id] supaya waiter bisa pakai cart UI standar
 *
 * @param tableId  - UUID meja yang dipilih
 * @param guestNames - List nama tamu. Index 0 = nama utama (jadi guest profile).
 *                     Length max = table.capacity.
 */
export interface StaffOpenTableInput {
  tableId: string;
  guestNames: string[];
  reservationAt?: string | null;
  reservationEndAt?: string | null;
  /** Item pesanan awal — WAJIB minimal 1. Tamu harus pesan & bayar dulu. */
  items: { menuItemId: string; quantity: number; notes?: string }[];
  /** Metode bayar di muka: 'qris' (QR) atau 'cash' (bayar di kasir). */
  payMethod: "qris" | "cash";
  /**
   * Buka meja atas nama AKUN PELANGGAN yang sudah ada (dipilih kasir dari menu
   * Customers) — meja & tagihan jadi milik akun itu, jadi kunjungan/riwayat
   * tercatat di profilnya. Kosong = buat guest profile baru seperti biasa.
   */
  hostProfileId?: string | null;
  /**
   * Akun pelanggan per BARIS tamu (sejajar dgn guestNames). Indeks yang berisi
   * profileId → dipakai profil pelanggan itu; null/undefined → guest profile
   * baru dari nama manual. Indeks 0 = host (bisa juga lewat hostProfileId).
   */
  memberProfileIds?: (string | null)[];
  /**
   * Kode voucher benefit membership. Boleh milik PELANGGAN TERDAFTAR MANA PUN
   * yang ada di meja ini (tak harus pemilik meja) — arahan user. Sesi belum
   * ada saat ini, jadi kepemilikan divalidasi lewat mode `ownerId`.
   */
  voucherCode?: string;
}

/**
 * Hasil buka meja walk-in. Meja BELUM benar-benar terbuka sampai pembayaran
 * lunas — memakai ulang mesin DP customer:
 * - qrisPending → tampilkan QR, meja terbuka begitu QR dibayar.
 * - awaitCashier → arahkan ke layar bayar-di-kasir (dibuka oleh WAITER: dia tak
 *   boleh terima uang, jadi tamu bayar ke kasir lain).
 * - paid → cash langsung lunas (dibuka oleh KASIR/manager/admin sendiri — dia
 *   terima uang di tempat, tak perlu antre ke dirinya). Meja langsung terbuka.
 */
export type StaffOpenTableResult =
  | { ok: true; sessionId: string; qris: { paymentId: string; qrString: string } }
  | { ok: true; sessionId: string; awaitCashier: true }
  | { ok: true; sessionId: string; paid: true }
  /**
   * Gagal VALIDASI (voucher tak berlaku, dsb) — di-RETURN, bukan throw, sebab
   * pesan Error dari server action disensor Next.js di build produksi.
   */
  | { ok: false; error: string };

export async function staffOpenTableForCustomer(
  input: StaffOpenTableInput
): Promise<StaffOpenTableResult> {
  const ctx = await requirePermission(
    "open_table_for_customer",
    "/staff/waiter"
  );
  const {
    tableId,
    guestNames,
    reservationAt,
    reservationEndAt,
    items,
    payMethod,
    hostProfileId,
    memberProfileIds,
  } = input;
  if (!items || items.length === 0) {
    return {
      ok: false,
      error: "Add at least one menu item. Payment is required to open the table",
    };
  }

  // Akun pelanggan yang dipilih staff per baris tamu (opsional). Validasi:
  // harus profil customer aktif (bukan guest walk-in, bukan staff) supaya
  // tagihan & riwayat menempel ke akun yang benar.
  // memberProfileIds[0] dan hostProfileId sama-sama menunjuk HOST — pakai yang
  // mana saja yang terisi.
  const pickedIds = Array.from(
    new Set(
      [hostProfileId ?? memberProfileIds?.[0] ?? null, ...(memberProfileIds ?? []).slice(1)]
        .filter((v): v is string => !!v)
    )
  );
  const accountById = new Map<string, { id: string; displayName: string }>();
  if (pickedIds.length > 0) {
    const rows = await db
      .select({
        id: profiles.id,
        displayName: profiles.displayName,
        isGuest: profiles.isGuest,
        isActive: profiles.isActive,
      })
      .from(profiles)
      .where(inArray(profiles.id, pickedIds));
    const staffHits = await db
      .select({ id: staffRoles.profileId })
      .from(staffRoles)
      .where(inArray(staffRoles.profileId, pickedIds));
    const staffSet = new Set(staffHits.map((s) => s.id));

    for (const id of pickedIds) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("Customer not found");
      if (row.isGuest) {
        return { ok: false, error: "That profile is a walk-in guest" };
      }
      if (!row.isActive) {
        return { ok: false, error: "That customer account is inactive" };
      }
      if (staffSet.has(id)) {
        return { ok: false, error: "Staff can't be added as a table guest" };
      }
      accountById.set(id, { id: row.id, displayName: row.displayName });
    }
  }

  const hostPickedId = hostProfileId ?? memberProfileIds?.[0] ?? null;
  const hostAccount = hostPickedId ? accountById.get(hostPickedId)! : null;

  // Reservasi (kalau jam dipilih) vs walk-in (langsung sekarang).
  const resAt = reservationAt ? new Date(reservationAt) : null;
  const resEnd = reservationEndAt ? new Date(reservationEndAt) : null;
  if (resAt && resEnd && resEnd.getTime() <= resAt.getTime()) {
    return { ok: false, error: "End time must be after start time" };
  }
  const isReservation = !!resAt;

  // Clean & filter empty names
  const cleanNames = guestNames
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (cleanNames.length === 0) {
    return { ok: false, error: "At least 1 guest name is required" };
  }
  if (cleanNames.some((n) => n.length > 80)) {
    return { ok: false, error: "Each guest name can be at most 80 characters" };
  }

  // Validate table aktif & ada di bar yang sama
  const [table] = await db
    .select({
      id: tables.id,
      label: tables.label,
      capacity: tables.capacity,
      isActive: tables.isActive,
      barId: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, tableId));

  if (!table) throw new Error("Table not found");
  if (!table.isActive) {
    return { ok: false, error: "Table is inactive" };
  }
  if (table.barId !== ctx.barId) throw new Error("Invalid bar access");
  if (cleanNames.length > table.capacity) {
    return {
      ok: false,
      error: `Maximum ${table.capacity} guests for this table (capacity)`,
    };
  }

  const mainGuest = cleanNames[0];

  // Snapshot harga menu (tolak item tak tersedia). Total = subtotal + charge;
  // tamu bayar PENUH di muka (dpFull).
  const menuIds = [...new Set(items.map((i) => i.menuItemId))];
  const menuRows = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      price: menuItems.price,
      is_available: menuItems.isAvailable,
      barId: menuCategories.barId,
    })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(inArray(menuItems.id, menuIds));
  const menuMap = new Map(menuRows.map((m) => [m.id, m]));
  for (const it of items) {
    const m = menuMap.get(it.menuItemId);
    if (!m) throw new Error("Menu item not found");
    if (m.barId !== ctx.barId) throw new Error("Invalid menu item");
    if (!m.is_available) {
      return {
        ok: false,
        error: `${m.name ?? "A selected menu item"} is currently unavailable`,
      };
    }
    if (it.quantity < 1 || it.quantity > 20) throw new Error("Invalid quantity");
  }
  const subtotal = items.reduce(
    (s, it) => s + (menuMap.get(it.menuItemId)!.price ?? 0) * it.quantity,
    0
  );
  const charge = await getChargeConfig(ctx.barId);
  const bill = computeBillTotals(subtotal, charge);
  if (bill.total <= 0) throw new Error("Order total must be greater than zero");

  // Voucher (opsional). Sesi belum ada, jadi kepemilikan dicek lewat mode
  // `ownerId` — dicoba ke SETIAP akun terdaftar di meja ini, terima yang
  // pertama cocok (arahan user: boleh milik anggota mana pun, tak harus
  // pemilik meja). Voucher yang dipakai dikunci per-BARIS, jadi voucher lain
  // milik orang yang sama tetap utuh.
  let voucher: { voucherId: string; code: string; discount: number } | null =
    null;
  const voucherCode = input.voucherCode?.trim();
  if (voucherCode) {
    const owners = Array.from(accountById.keys());
    if (owners.length === 0) {
      return {
        ok: false,
        error: "Vouchers are only for registered customers",
      };
    }
    let lastError = "This voucher can't be used here";
    for (const ownerId of owners) {
      const res = await resolveVoucherForBillPayment({
        code: voucherCode,
        amount: bill.total,
        ownerId,
      });
      if (res.ok) {
        voucher = {
          voucherId: res.voucher.voucherId,
          code: res.voucher.code,
          discount: res.voucher.discount,
        };
        break;
      }
      lastError = res.error;
    }
    if (!voucher) return { ok: false, error: lastError };
  }

  // Nominal yang benar-benar ditagih setelah potongan. Bisa 0 → gateway
  // DILEWATI (QRIS minimum Rp 1.000, tak bisa menagih nol).
  const payAmount = Math.max(0, bill.total - (voucher?.discount ?? 0));
  const fullyCoveredByVoucher = payAmount <= 0;

  let sessionId: string;
  let orderId: string;
  let paymentId: string;
  try {
    const result = await db.transaction(async (tx) => {
      // 1-2. Host meja. Kalau kasir memilih AKUN pelanggan → pakai profil itu
      // (tagihan & riwayat menempel ke akunnya). Kalau tidak → buat guest
      // profile baru (fake email, tanpa password: tak bisa login).
      let newProfile: { id: string };
      if (hostAccount) {
        newProfile = { id: hostAccount.id };
      } else {
        const guestToken = crypto.randomBytes(8).toString("hex");
        const guestEmail = `guest-${guestToken}@walkin.soho`;

        const [newUser] = await tx
          .insert(users)
          .values({
            email: guestEmail,
            name: mainGuest,
            passwordHash: null, // No login
          })
          .returning({ id: users.id });

        const [createdProfile] = await tx
          .insert(profiles)
          .values({
            id: newUser.id, // 1-1 with users
            displayName: mainGuest,
            isGuest: true,
          })
          .returning({ id: profiles.id });
        newProfile = createdProfile;
      }

      // 3. Insert session — host = guest profile (bukan waiter!)
      const [newSession] = await tx
        .insert(tableSessions)
        .values({
          tableId,
          hostId: newProfile.id, // Guest = host (yang punya bill)
          // Wajib bayar dulu: meja BELUM benar-benar terbuka. Mulai "reserved"
          // (menunggu bayar) baik walk-in maupun booking — dp_paid_at masih
          // NULL. settleOrderIfPaid + promoteDueReservations mempromosikannya
          // ke "open" setelah lunas; expireDpIfOverdue membatalkan kalau tak
          // dibayar (QRIS 60 dtk / bayar-di-kasir 10 mnt) → meja bebas lagi.
          status: "reserved",
          visibility: "invite_only",
          title: mainGuest,
          maxGuests: table.capacity,
          openedByStaffId: ctx.profileId, // Audit: waiter yang buka
          guestNames: cleanNames,
          reservationAt: resAt,
          reservationEndAt: resEnd,
        })
        .returning({ id: tableSessions.id });

      // 4. Insert session member — HANYA guest sebagai host.
      // Waiter TIDAK jadi member meja — dia hanya operator (audit trail di
      // opened_by_staff_id). Saat input order, item akan di-attribute ke
      // member meja (guest), dengan input_by_staff_id = waiter untuk audit.
      const [hostMember] = await tx
        .insert(sessionMembers)
        .values({
          sessionId: newSession.id,
          profileId: newProfile.id,
          role: "host",
          status: "joined",
        })
        .returning({ id: sessionMembers.id });

      // Kalau ada tamu tambahan (cleanNames[1..]), bikin guest profile untuk
      // tiap tamu juga supaya semua tamu tampak di member list.
      if (cleanNames.length > 1) {
        for (let i = 1; i < cleanNames.length; i++) {
          const extraName = cleanNames[i];
          // Baris ini menunjuk AKUN pelanggan? Pakai profilnya (tak bikin guest
          // baru) supaya kunjungan tercatat di akun orang tsb.
          const pickedId = memberProfileIds?.[i] ?? null;
          const picked = pickedId ? accountById.get(pickedId) : null;
          if (picked) {
            // Host sudah jadi member; jangan dobel kalau dipilih lagi.
            if (picked.id === newProfile.id) continue;
            await tx
              .insert(sessionMembers)
              .values({
                sessionId: newSession.id,
                profileId: picked.id,
                role: "member",
                status: "joined",
              })
              .onConflictDoNothing();
            continue;
          }
          const extraToken = crypto.randomBytes(8).toString("hex");
          const extraEmail = `guest-${extraToken}@walkin.soho`;
          const [extraUser] = await tx
            .insert(users)
            .values({
              email: extraEmail,
              name: extraName,
              passwordHash: null,
            })
            .returning({ id: users.id });
          const [extraProfile] = await tx
            .insert(profiles)
            .values({
              id: extraUser.id,
              displayName: extraName,
              isGuest: true,
            })
            .returning({ id: profiles.id });
          await tx.insert(sessionMembers).values({
            sessionId: newSession.id,
            profileId: extraProfile.id,
            role: "member",
            status: "joined",
          });
        }
      }

      // Order awal: 'unpaid' + item 'draft' (BELUM masuk dapur). Baru "masuk"
      // (paid + item 'sent') setelah pembayaran lunas — via settleOrderIfPaid.
      const [newOrder] = await tx
        .insert(orders)
        .values({ sessionId: newSession.id, status: "unpaid", paidAt: null })
        .returning({ id: orders.id });

      await tx.insert(orderItems).values(
        items.map((it) => ({
          orderId: newOrder.id,
          menuItemId: it.menuItemId,
          addedByMemberId: hostMember.id,
          inputByStaffId: ctx.profileId, // audit: staff yang input
          quantity: it.quantity,
          unitPrice: menuMap.get(it.menuItemId)!.price,
          notes: it.notes ?? null,
          status: "draft" as const,
        }))
      );

      // Pembayaran di muka PENUH (dpFull) — tamu bayar seluruh tagihan sebelum
      // meja terbuka. 'pending' sampai QRIS dibayar / kasir konfirmasi.
      // Voucher menutup SELURUH tagihan → tak ada yang perlu ditagih.
      // Gateway dilewati (QRIS minimum Rp 1.000, tak bisa menagih nol):
      // payment dicatat langsung lunas sebagai baris voucher.
      const [newPayment] = await tx
        .insert(payments)
        .values({
          orderId: newOrder.id,
          paidByMemberId: hostMember.id,
          amount: fullyCoveredByVoucher ? voucher!.discount : payAmount,
          method: fullyCoveredByVoucher ? "voucher" : payMethod,
          status: fullyCoveredByVoucher ? "paid" : "pending",
          splitMode: "custom",
          splitMeta: fullyCoveredByVoucher
            ? {
                isDownPayment: true,
                dpFull: true,
                voucherCode: voucher!.code,
                voucherId: voucher!.voucherId,
              }
            : {
                isDownPayment: true,
                dpFull: true,
                ...(voucher
                  ? {
                      voucherCode: voucher.code,
                      voucherDiscount: voucher.discount,
                    }
                  : {}),
              },
          paidAt: fullyCoveredByVoucher ? new Date() : null,
        })
        .returning({ id: payments.id });

      // Kunci voucher DI DALAM transaksi: kalau tx di-rollback, penguncian
      // ikut batal sehingga voucher tak hangus percuma. Mengunci per-BARIS
      // (WHERE id = voucherId), jadi voucher lain milik orang yang sama tetap
      // utuh. Kalah balapan → batalkan seluruh tx (meja tak jadi terbuka).
      if (voucher) {
        const [locked] = await tx
          .update(memberVouchers)
          .set({
            usedPaymentId: newPayment.id,
            discountApplied: voucher.discount,
          })
          .where(
            and(
              eq(memberVouchers.id, voucher.voucherId),
              isNull(memberVouchers.usedAt),
              isNull(memberVouchers.usedPaymentId)
            )
          )
          .returning({ id: memberVouchers.id });
        if (!locked) throw new Error(VOUCHER_RACE_LOST);
      }

      return {
        sessionId: newSession.id,
        orderId: newOrder.id,
        paymentId: newPayment.id,
      };
    });
    sessionId = result.sessionId;
    orderId = result.orderId;
    paymentId = result.paymentId;
  } catch (err) {
    // Voucher keburu dipakai di tempat lain. Transaksi sudah rollback penuh
    // (meja tak terbuka, voucher TIDAK hangus) — cukup beri tahu kasir.
    if (err instanceof Error && err.message === VOUCHER_RACE_LOST) {
      return { ok: false, error: "This voucher was just used. Try another one" };
    }
    if (isDbConstraintError(err, "uq_active_session_per_table")) {
      return { ok: false, error: "This table already has an active session" };
    }
    // Race condition: slot waktu meja ini baru saja dibooking lebih dulu.
    if (isDbConstraintError(err, "no_overlapping_reservation")) {
      return {
        ok: false,
        error:
          "This table's time slot was just booked. Pick another time or table.",
      };
    }
    const message = err instanceof Error ? err.message : "";
    throw new Error(message || "Failed to open table");
  }

  // Audit: staff membuka meja atas nama tamu. Dicatat SEKALI di sini (sesi &
  // order sudah jadi), sebelum percabangan metode bayar — supaya tak dobel
  // dan tak terlewat di salah satu jalur (cash/QRIS/bayar-di-kasir).
  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "session.opened",
    category: "session",
    summary: `Opened table ${table.label} for ${mainGuest}${
      hostAccount ? " (registered account)" : ""
    }`,
    entityType: "session",
    entityId: sessionId,
    meta: {
      tableLabel: table.label,
      guestCount: cleanNames.length,
      amount: payAmount,
      payMethod,
      isReservation,
      hostAccountId: hostAccount?.id ?? null,
    },
  });

  void orderId; // dipakai lewat settleOrderIfPaid via jalur pembayaran

  // Voucher menutup SELURUH tagihan → tak ada yang ditagih, gateway dilewati
  // (QRIS minimum Rp 1.000). Payment sudah 'paid' sejak di transaksi; tinggal
  // tandai voucher terpakai & buka mejanya. skipSyntheticRow: barisnya SUDAH
  // berupa payment voucher, jadi tak perlu baris sintetis tambahan.
  if (fullyCoveredByVoucher) {
    await settleVoucherForPayment(paymentId, { skipSyntheticRow: true });
    await settleOrderIfPaid(orderId);
    await notify(channels.session(sessionId), { type: "payment.paid" });
    await notify(channels.staff(ctx.barId), { type: "payment.paid" });
    await notify(channels.bar(ctx.barId), { type: "payment.paid" });
    revalidatePath("/staff/waiter");
    revalidatePath("/staff/cashier");
    return { ok: true, sessionId, paid: true };
  }

  // Proses pembayaran di muka. Pola sama dengan DP customer (openTable).
  if (payMethod === "cash") {
    // Kasir/manager/admin yang buka meja SENDIRI → dia yang terima uang di
    // tempat. Tak masuk akal mengarahkannya ke layar "bayar ke kasir" (dirinya
    // sendiri). Langsung tandai lunas → meja terbuka & pesanan masuk dapur.
    // cashierMarkPaymentPaid mengecek ulang izin receive_payment (aman kalau
    // suatu saat role berubah) & menjalankan semua hook (dp_paid_at, settle,
    // split, notif).
    if (can(ctx.role, "receive_payment")) {
      await db
        .update(payments)
        .set({
          externalRef: `cashier_${paymentId}`,
          splitMeta: { isDownPayment: true, dpFull: true },
        })
        .where(eq(payments.id, paymentId));
      await cashierMarkPaymentPaid(paymentId);
      revalidatePath("/staff/waiter");
      revalidatePath("/staff/cashier");
      return { ok: true, sessionId, paid: true };
    }

    // WAITER yang buka: dia tak boleh terima uang → tamu bayar ke kasir.
    // 'pending' + batas 10 menit; lewat itu expireDpIfOverdue membatalkan
    // booking & mejanya bebas lagi.
    await db
      .update(payments)
      .set({
        externalRef: `cashier_${paymentId}`,
        splitMeta: {
          isDownPayment: true,
          dpFull: true,
          payAtCashier: true,
          expiresAt: new Date(
            Date.now() + PAY_AT_CASHIER_TIMEOUT_SECONDS * 1000
          ).toISOString(),
        },
      })
      .where(eq(payments.id, paymentId));
    await notifyCashiersPayAtCashier({ paymentId, isDownPayment: true });
    await notify(channels.staff(ctx.barId), { type: "session.opened" });
    revalidatePath("/staff/waiter");
    revalidatePath("/staff/cashier");
    return { ok: true, sessionId, awaitCashier: true };
  }

  // QRIS: charge gateway. Kalau gagal, batalkan sesi (tak ada meja
  // "menggantung" tanpa cara bayar) lalu lempar error.
  try {
    const gateway = getPaymentGateway();
    const chargeResult = await gateway.createCharge({
      paymentId,
      amount: payAmount,
      method: "qris",
      payerName: mainGuest,
      description: `Walk-in table ${table.id.slice(0, 8)}`,
    });
    await db
      .update(payments)
      .set({
        externalRef: chargeResult.externalRef,
        status: chargeResult.status,
        paidAt: chargeResult.status === "paid" ? new Date() : null,
        splitMeta: {
          isDownPayment: true,
          dpFull: true,
          // Pertahankan info voucher — tanpa ini metadata QRIS menimpanya
          // dan jejak potongan hilang dari struk/riwayat.
          ...(voucher
            ? { voucherCode: voucher.code, voucherDiscount: voucher.discount }
            : {}),
          qrString: chargeResult.qrString ?? null,
          redirectUrl: chargeResult.redirectUrl ?? null,
          expiresAt: new Date(
            Date.now() + DP_TIMEOUT_SECONDS * 1000
          ).toISOString(),
          merchantOrderId: chargeResult.merchantOrderId ?? paymentId,
        },
      })
      .where(eq(payments.id, paymentId));

    if (chargeResult.status === "paid") {
      // Langsung lunas (mis. mock) → meja terbuka sekarang.
      await db
        .update(tableSessions)
        .set({ dpPaidAt: new Date() })
        .where(eq(tableSessions.id, sessionId));
      await settleOrderIfPaid(orderId);
      await settleOverdueIfPaid(sessionId);
      await notify(channels.staff(ctx.barId), { type: "session.opened" });
      revalidatePath("/staff/waiter");
      revalidatePath("/staff/cashier");
      redirect(`/session/${sessionId}`);
    }

    if (!chargeResult.qrString) {
      throw new Error("Payment gateway did not return a QR");
    }
    await notify(channels.staff(ctx.barId), { type: "session.opened" });
    revalidatePath("/staff/waiter");
    revalidatePath("/staff/cashier");
    return {
      ok: true,
      sessionId,
      qris: { paymentId, qrString: chargeResult.qrString },
    };
  } catch (err) {
    // NEXT_REDIRECT dari cabang paid → lempar ulang.
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    // Gateway gagal → batalkan sesi supaya meja tak menggantung tanpa cara bayar.
    await db
      .update(tableSessions)
      .set({ status: "cancelled", closedAt: new Date() })
      .where(eq(tableSessions.id, sessionId))
      .catch(() => {});
    // Sesi batal → voucher WAJIB dilepas. Transaksi sudah commit, jadi
    // rollback tak lagi menolong: tanpa ini vouchernya hangus percuma
    // padahal tamu tak jadi bayar apa pun.
    if (voucher) {
      await releaseVoucherForPayment(paymentId).catch(() => {});
    }
    console.error("[staffOpenTable] QRIS charge failed:", err);
    throw new Error(
      "Payment gateway is unavailable right now. Please try again or use pay-at-cashier."
    );
  }
}

// ============================================================
// ADD GUEST TO EXISTING TABLE
// ============================================================

/**
 * Staff tambah tamu baru ke meja yang sudah aktif.
 *
 * Validasi: slot belum penuh (current member count < table.capacity), session
 * masih open, session memang dibuka oleh staff (walk-in). Untuk session
 * customer biasa (self-service), tidak boleh — biar customer invite sendiri.
 */
export async function staffAddGuestToTable(
  sessionId: string,
  guestName: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission(
    "open_table_for_customer",
    "/staff/waiter"
  );

  const cleanName = guestName.trim();
  if (!cleanName) return { ok: false, error: "Guest name is required" };
  if (cleanName.length > 80) {
    return { ok: false, error: "Guest name can be at most 80 characters" };
  }

  // Get session + capacity
  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      openedByStaffId: tableSessions.openedByStaffId,
      tableCapacity: tables.capacity,
      allowOverCapacity: tables.allowOverCapacity,
      barId: floorAreas.barId,
      tableLabel: tables.label,
      guestNames: tableSessions.guestNames,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  if (!session) throw new Error("Session not found");
  if (session.barId !== ctx.barId) throw new Error("Invalid bar access");
  if (session.status !== "open") {
    return { ok: false, error: "Session is no longer open" };
  }
  if (!session.openedByStaffId) {
    return {
      ok: false,
      error:
        "This session was opened by the customer. Ask the customer to invite their friends",
    };
  }

  // Count current members
  const [memberCountRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "joined")
      )
    );
  const currentCount = Number(memberCountRow?.count ?? 0);

  // Dilewati kalau meja izinkan over-capacity (setting admin).
  if (!session.allowOverCapacity && currentCount >= session.tableCapacity) {
    return {
      ok: false,
      error: `Table is full (${currentCount}/${session.tableCapacity})`,
    };
  }

  // Insert guest user + profile + member dalam transaction
  await db.transaction(async (tx) => {
    const token = crypto.randomBytes(8).toString("hex");
    const fakeEmail = `guest-${token}@walkin.soho`;

    const [newUser] = await tx
      .insert(users)
      .values({
        email: fakeEmail,
        name: cleanName,
        passwordHash: null,
      })
      .returning({ id: users.id });

    const [newProfile] = await tx
      .insert(profiles)
      .values({
        id: newUser.id,
        displayName: cleanName,
        isGuest: true,
      })
      .returning({ id: profiles.id });

    await tx.insert(sessionMembers).values({
      sessionId,
      profileId: newProfile.id,
      role: "member",
      status: "joined",
    });

    // Update guest_names di session untuk denormalized cache
    await tx
      .update(tableSessions)
      .set({ guestNames: [...session.guestNames, cleanName] })
      .where(eq(tableSessions.id, sessionId));
  });

  await logActivity({
    actorId: ctx.profileId,
    barId: ctx.barId,
    action: "session.guest_added",
    category: "session",
    entityType: "session",
    entityId: sessionId,
    summary: `Added guest ${cleanName} to table ${session.tableLabel}`,
    meta: {
      guestName: cleanName,
      sessionId,
      tableLabel: session.tableLabel,
    },
  });

  await notify(channels.session(sessionId), { type: "member.joined" });
  await notify(channels.staff(ctx.barId), { type: "member.joined" });
  await notify(channels.bar(ctx.barId), { type: "member.joined" });

  revalidatePath(`/session/${sessionId}`);
  revalidatePath("/staff/waiter");
  return { ok: true };
}
