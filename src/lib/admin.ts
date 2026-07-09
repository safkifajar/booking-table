/**
 * Admin-side data fetching helpers.
 *
 * Migrated dari Supabase client ke Drizzle ORM (Phase 3b).
 *
 * Strategy:
 * - requireAdmin: pakai auth-v2/current.ts (Auth.js + Drizzle staff_roles lookup)
 * - Sales report queries: panggil Postgres RPC functions (admin_sales_summary,
 *   admin_top_items, dst.) via db.execute(sql`...`). RPC sudah port ke
 *   local Postgres via migration 0012_admin_reports.sql.
 * - getAllItemsPerformance: pure Drizzle (gabungan menu_items + RPC result).
 * - getTransactionDetail: pure Drizzle joins (no RPC).
 *
 * Return shape preserve snake_case match types/db.ts contract.
 */

import { redirect } from "next/navigation";
import { and, eq, sql, desc } from "drizzle-orm";
import { alias as aliasedTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { menuCategories, menuItems } from "@/lib/db/schema/menu";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { staffRoles } from "@/lib/db/schema/extras";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { tableMoveRequests } from "@/lib/db/schema/move-requests";
import { requireAdmin as requireAdminAuth } from "@/lib/auth-v2/current";
import { getChargeConfig } from "@/lib/settings-actions";
import { computeBillTotals } from "@/lib/settings-constants";
import type { PaymentMethod } from "@/types/db";

// ============================================================
// AUTH GUARD
// ============================================================

export interface AdminBar {
  id: string;
  slug: string;
  name: string;
  /**
   * Role hasil requireAdminAuth(). Sebenarnya cuma admin/manager bisa lolos
   * (lihat auth-v2/current.ts requireAdmin inArray check), tapi tipe-nya
   * inherit dari StaffContext yang punya semua role.
   */
  role: "admin" | "manager" | "cashier" | "waiter";
}

/**
 * Server-side guard: redirect kalau bukan admin atau manager.
 * Wraps auth-v2/current.ts requireAdmin — preserve AdminBar shape untuk callers.
 */
export async function requireAdmin(): Promise<AdminBar> {
  const ctx = await requireAdminAuth();
  return {
    id: ctx.barId,
    slug: ctx.barSlug,
    name: ctx.barName,
    role: ctx.role,
  };
}

// ============================================================
// SHARED TYPES
// ============================================================

export interface SalesSummary {
  total_revenue: number;
  transaction_count: number;
  unique_visitors: number;
  avg_bill: number;
  total_items: number;
  avg_items_per_transaction: number;
}

export interface SummaryWithDelta extends SalesSummary {
  prev: SalesSummary;
  delta_revenue_pct: number | null;
  delta_transaction_pct: number | null;
  delta_visitors_pct: number | null;
}

export interface TopItem {
  menu_item_id: string;
  name: string;
  category_name: string;
  total_qty: number;
  total_revenue: number;
  transaction_count: number;
}

export interface SalesByHour {
  hour_of_day: number;
  total_revenue: number;
  transaction_count: number;
}

export interface SalesByDay {
  sale_date: string;
  total_revenue: number;
  transaction_count: number;
}

export interface PaymentMethodSummary {
  method: PaymentMethod;
  total_amount: number;
  payment_count: number;
  pct_share: number;
}

/** Status pembayaran transaksi (lunas vs belum lunas) — sesi closed + overdue. */
export interface PaymentStatusBreakdown {
  paid_count: number;
  /** Nilai tagihan transaksi lunas (subtotal). */
  paid_revenue: number;
  unpaid_count: number;
  /** Nilai tagihan penuh transaksi belum lunas (subtotal). paid_revenue + unpaid_billed = total tagihan. */
  unpaid_billed: number;
  /** Sisa yg belum dibayar (subtotal - paid) — angka untuk nagih. */
  unpaid_outstanding: number;
}

export interface AdminTransaction {
  session_id: string;
  /** open/locked = berjalan; closed/overdue = selesai. */
  status: string;
  /** null = sesi belum ditutup (berjalan/overdue). */
  closed_at: string | null;
  started_at: string;
  duration_minutes: number;
  table_label: string;
  area_name: string;
  host_name: string;
  member_count: number;
  item_count: number;
  subtotal: number;
  paid_total: number;
  session_title: string | null;
}

// ============================================================
// DATE RANGE
// ============================================================

/**
 * Hitung period sebelumnya dengan durasi sama.
 * Range "Bulan ini" → prev = "Bulan lalu" (durasi sama dari from).
 */
export function getPreviousRange(from: string, to: string): { from: string; to: string } {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const duration = toMs - fromMs;
  return {
    from: new Date(fromMs - duration).toISOString(),
    to: from,
  };
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) {
    if (curr === 0) return 0;
    return null;
  }
  return Math.round(((curr - prev) / prev) * 100);
}

// ============================================================
// SALES REPORTS — call Postgres RPC via db.execute
// ============================================================

/**
 * Wrapper untuk call RPC + cast result type.
 * Pakai db.execute() supaya postgres.js return raw array of rows.
 */
async function callRpc<T>(sqlQuery: ReturnType<typeof sql>): Promise<T[]> {
  const rows = (await db.execute(sqlQuery)) as unknown as T[];
  return rows;
}

export async function getSalesSummary(
  barId: string,
  from: string,
  to: string
): Promise<SalesSummary> {
  const rows = await callRpc<{
    total_revenue: string | number;
    transaction_count: number;
    unique_visitors: number;
    avg_bill: string | number;
    total_items: number;
    avg_items_per_transaction: string | number;
  }>(sql`SELECT * FROM admin_sales_summary(${barId}::uuid, ${from}::timestamptz, ${to}::timestamptz)`);

  const row = rows[0];
  return {
    total_revenue: Number(row?.total_revenue ?? 0),
    transaction_count: Number(row?.transaction_count ?? 0),
    unique_visitors: Number(row?.unique_visitors ?? 0),
    avg_bill: Number(row?.avg_bill ?? 0),
    total_items: Number(row?.total_items ?? 0),
    avg_items_per_transaction: Number(row?.avg_items_per_transaction ?? 0),
  };
}

export async function getSummaryWithDelta(
  barId: string,
  from: string,
  to: string
): Promise<SummaryWithDelta> {
  const prev = getPreviousRange(from, to);
  const [curr, prevSummary] = await Promise.all([
    getSalesSummary(barId, from, to),
    getSalesSummary(barId, prev.from, prev.to),
  ]);
  return {
    ...curr,
    prev: prevSummary,
    delta_revenue_pct: pctDelta(curr.total_revenue, prevSummary.total_revenue),
    delta_transaction_pct: pctDelta(
      curr.transaction_count,
      prevSummary.transaction_count
    ),
    delta_visitors_pct: pctDelta(curr.unique_visitors, prevSummary.unique_visitors),
  };
}

export async function getTopItems(
  barId: string,
  from: string,
  to: string,
  limit = 20
): Promise<TopItem[]> {
  const rows = await callRpc<TopItem>(
    sql`SELECT * FROM admin_top_items(${barId}::uuid, ${from}::timestamptz, ${to}::timestamptz, ${limit})`
  );
  return rows.map((r) => ({
    ...r,
    total_qty: Number(r.total_qty),
    total_revenue: Number(r.total_revenue),
    transaction_count: Number(r.transaction_count),
  }));
}

/**
 * Semua menu item di bar (termasuk yang belum laku di periode ini).
 * Sort by revenue desc — yang paling laris di atas, yang belum terjual di bawah.
 *
 * Pure Drizzle: ambil semua items + categories untuk bar, merge dengan
 * stats hasil RPC admin_top_items.
 */
export async function getAllItemsPerformance(
  barId: string,
  from: string,
  to: string
): Promise<TopItem[]> {
  // Get all menu items in bar (join via categories)
  const allItems = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      category_name: menuCategories.name,
    })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(eq(menuCategories.barId, barId));

  // Stats untuk periode (limit besar = ambil semua)
  const stats = await getTopItems(barId, from, to, 10000);
  const statsMap = new Map(stats.map((s) => [s.menu_item_id, s]));

  // Merge: kalau ada di stats pakai stats, kalau tidak buat dengan 0
  const merged: TopItem[] = allItems.map((it) => {
    const s = statsMap.get(it.id);
    if (s) return s;
    return {
      menu_item_id: it.id,
      name: it.name,
      category_name: it.category_name,
      total_qty: 0,
      total_revenue: 0,
      transaction_count: 0,
    };
  });

  // Sort by revenue desc, lalu qty desc, lalu nama
  merged.sort((a, b) => {
    if (b.total_revenue !== a.total_revenue)
      return b.total_revenue - a.total_revenue;
    if (b.total_qty !== a.total_qty) return b.total_qty - a.total_qty;
    return a.name.localeCompare(b.name);
  });

  return merged;
}

export async function getSalesByHour(
  barId: string,
  from: string,
  to: string
): Promise<SalesByHour[]> {
  const rows = await callRpc<SalesByHour>(
    sql`SELECT * FROM admin_sales_by_hour(${barId}::uuid, ${from}::timestamptz, ${to}::timestamptz)`
  );
  return rows.map((r) => ({
    ...r,
    hour_of_day: Number(r.hour_of_day),
    total_revenue: Number(r.total_revenue),
    transaction_count: Number(r.transaction_count),
  }));
}

export async function getSalesByDay(
  barId: string,
  from: string,
  to: string
): Promise<SalesByDay[]> {
  const rows = await callRpc<{
    sale_date: Date | string;
    total_revenue: string | number;
    transaction_count: number;
  }>(sql`SELECT * FROM admin_sales_by_day(${barId}::uuid, ${from}::timestamptz, ${to}::timestamptz)`);
  return rows.map((r) => ({
    sale_date: typeof r.sale_date === "string" ? r.sale_date : r.sale_date.toISOString().slice(0, 10),
    total_revenue: Number(r.total_revenue),
    transaction_count: Number(r.transaction_count),
  }));
}

export async function getPaymentMethods(
  barId: string,
  from: string,
  to: string
): Promise<PaymentMethodSummary[]> {
  const rows = await callRpc<PaymentMethodSummary>(
    sql`SELECT * FROM admin_payment_methods(${barId}::uuid, ${from}::timestamptz, ${to}::timestamptz)`
  );
  return rows.map((r) => ({
    ...r,
    total_amount: Number(r.total_amount),
    payment_count: Number(r.payment_count),
    pct_share: Number(r.pct_share),
  }));
}

export async function getPaymentStatusBreakdown(
  barId: string,
  from: string,
  to: string
): Promise<PaymentStatusBreakdown> {
  const rows = await callRpc<{
    paid_count: number;
    paid_revenue: string | number;
    unpaid_count: number;
    unpaid_billed: string | number;
    unpaid_outstanding: string | number;
  }>(
    sql`SELECT * FROM admin_payment_status(${barId}::uuid, ${from}::timestamptz, ${to}::timestamptz)`
  );
  const r = rows[0];
  return {
    paid_count: Number(r?.paid_count ?? 0),
    paid_revenue: Number(r?.paid_revenue ?? 0),
    unpaid_count: Number(r?.unpaid_count ?? 0),
    unpaid_billed: Number(r?.unpaid_billed ?? 0),
    unpaid_outstanding: Number(r?.unpaid_outstanding ?? 0),
  };
}

export async function getTransactions(
  barId: string,
  from: string,
  to: string,
  limit = 100,
  offset = 0
): Promise<AdminTransaction[]> {
  const rows = await callRpc<{
    session_id: string;
    status: string;
    closed_at: Date | string | null;
    started_at: Date | string;
    duration_minutes: number;
    table_label: string;
    area_name: string;
    host_name: string;
    member_count: number;
    item_count: number;
    subtotal: string | number;
    paid_total: string | number;
    session_title: string | null;
  }>(sql`SELECT * FROM admin_transactions(${barId}::uuid, ${from}::timestamptz, ${to}::timestamptz, ${limit}, ${offset})`);

  return rows.map((r) => ({
    session_id: r.session_id,
    status: r.status,
    // belum ditutup (berjalan/overdue) → closed_at null
    closed_at:
      r.closed_at == null
        ? null
        : typeof r.closed_at === "string"
          ? r.closed_at
          : r.closed_at.toISOString(),
    started_at: typeof r.started_at === "string" ? r.started_at : r.started_at.toISOString(),
    duration_minutes: Number(r.duration_minutes),
    table_label: r.table_label,
    area_name: r.area_name,
    host_name: r.host_name,
    member_count: Number(r.member_count),
    item_count: Number(r.item_count),
    subtotal: Number(r.subtotal),
    paid_total: Number(r.paid_total),
    session_title: r.session_title,
  }));
}

// ============================================================
// PAYMENTS — daftar tiap transaksi pembayaran (pure Drizzle)
// ============================================================

/** Satu baris transaksi pembayaran (untuk /admin/payments). */
export interface AdminPayment {
  id: string;
  session_id: string;
  amount: number;
  method: string;
  status: string;
  split_mode: string;
  /** Waktu proses bayar (paidAt kalau ada, fallback createdAt). */
  at: string;
  paid_by_name: string;
  table_label: string;
  area_name: string;
}

/**
 * Daftar SEMUA pembayaran di bar pada rentang waktu. Difilter pakai
 * COALESCE(paidAt, createdAt) supaya pending (paidAt null) tetap masuk
 * berdasar waktu dibuat. Urut terbaru.
 */
export async function getPayments(
  barId: string,
  from: string,
  to: string,
  limit = 500
): Promise<AdminPayment[]> {
  const atExpr = sql<Date>`COALESCE(${payments.paidAt}, ${payments.createdAt})`;
  const rows = await db
    .select({
      id: payments.id,
      session_id: tableSessions.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      split_mode: payments.splitMode,
      at: atExpr,
      paid_by_name: profiles.displayName,
      table_label: tables.label,
      area_name: floorAreas.name,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        // Cast eksplisit ke timestamptz — `from`/`to` adalah ISO string.
        // Tanpa cast, Date object dikirim sbg toString() yg invalid utk timestamp.
        sql`${atExpr} >= ${from}::timestamptz`,
        sql`${atExpr} <= ${to}::timestamptz`
      )
    )
    .orderBy(desc(atExpr))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    session_id: r.session_id,
    amount: Number(r.amount),
    method: r.method,
    status: r.status,
    split_mode: r.split_mode,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    paid_by_name: r.paid_by_name,
    table_label: r.table_label,
    area_name: r.area_name,
  }));
}

/** Detail satu pembayaran (halaman /admin/payments/[id]). */
export interface AdminPaymentDetail {
  id: string;
  amount: number;
  method: string;
  status: string;
  split_mode: string;
  external_ref: string | null;
  created_at: string;
  paid_at: string | null;
  paid_by_name: string;
  /** Konteks transaksi meja terkait (untuk link ke detail transaksi). */
  session_id: string;
  session_title: string | null;
  table_label: string;
  area_name: string;
  host_name: string;
}

/**
 * Detail satu pembayaran by id (scoped ke bar). Null kalau tak ada / beda bar.
 * Host di-join via alias profiles kedua (tableSessions.hostId).
 */
export async function getPaymentDetail(
  barId: string,
  paymentId: string
): Promise<AdminPaymentDetail | null> {
  const hostProfiles = aliasedTable(profiles, "host_profiles");
  const [row] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      split_mode: payments.splitMode,
      external_ref: payments.externalRef,
      created_at: payments.createdAt,
      paid_at: payments.paidAt,
      paid_by_name: profiles.displayName,
      session_id: tableSessions.id,
      session_title: tableSessions.title,
      table_label: tables.label,
      area_name: floorAreas.name,
      host_name: hostProfiles.displayName,
      bar_id: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .innerJoin(hostProfiles, eq(hostProfiles.id, tableSessions.hostId))
    .where(and(eq(payments.id, paymentId), eq(floorAreas.barId, barId)));

  if (!row) return null;
  return {
    id: row.id,
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    split_mode: row.split_mode,
    external_ref: row.external_ref,
    created_at: row.created_at.toISOString(),
    paid_at: row.paid_at ? row.paid_at.toISOString() : null,
    paid_by_name: row.paid_by_name,
    session_id: row.session_id,
    session_title: row.session_title,
    table_label: row.table_label,
    area_name: row.area_name,
    host_name: row.host_name,
  };
}

// ============================================================
// TRANSACTION DETAIL — untuk drawer (pure Drizzle, no RPC)
// ============================================================

export interface TransactionDetailItem {
  id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  status: string;
  queue_number: number | null;
  menu_item_name: string;
  added_by_name: string;
}

export interface TransactionDetailPayment {
  id: string;
  amount: number;
  method: string;
  status: string;
  split_mode: string;
  paid_at: string | null;
  paid_by_name: string;
  /** Meja saat pembayaran ini (ter-infer dari riwayat pindah). null = tak ada pindah. */
  at_table: string | null;
}

export interface TransactionDetailMember {
  profile_id: string;
  name: string;
  avatar: string | null;
  role: string;
  status: string;
  is_guest: boolean;
  /** Customer terdaftar (is_guest=false & bukan staff) → punya halaman detail. */
  is_customer: boolean;
}

export interface TransactionMoveHistory {
  id: string;
  from_label: string;
  to_label: string;
  status: string;
  /** Waktu resolusi (approved/rejected) atau dibuat kalau belum. */
  at: string;
  /** Nama staff yg approve/reject (null = belum diproses / staff dihapus). */
  by_staff_name: string | null;
}

export interface TransactionDetail {
  session_id: string;
  status: string;
  title: string | null;
  visibility: string;
  vibe_tags: string[];
  started_at: string;
  closed_at: string | null;
  table_label: string;
  table_shape: string;
  table_capacity: number;
  area_name: string;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  members: TransactionDetailMember[];
  items: TransactionDetailItem[];
  payments: TransactionDetailPayment[];
  subtotal: number;
  /** Pajak (dari config bar). */
  tax: number;
  /** Service charge (dari config bar). */
  service: number;
  /** subtotal + tax + service. */
  total: number;
  total_paid: number;
  /** Riwayat pindah meja (dari→ke), terlama dulu. Kosong = tak pernah pindah. */
  move_history: TransactionMoveHistory[];
}

export async function getTransactionDetail(
  barId: string,
  sessionId: string
): Promise<TransactionDetail | null> {
  // 1. Session + table + area + host
  const [sessionRow] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      title: tableSessions.title,
      visibility: tableSessions.visibility,
      vibe_tags: tableSessions.vibeTags,
      started_at: tableSessions.startedAt,
      closed_at: tableSessions.closedAt,
      table_label: tables.label,
      table_shape: tables.shape,
      table_capacity: tables.capacity,
      area_name: floorAreas.name,
      bar_id: floorAreas.barId,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(eq(tableSessions.id, sessionId));

  if (!sessionRow) return null;
  if (sessionRow.bar_id !== barId) return null;

  // 2. Order(s) — ambil yg pertama dibuat
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.sessionId, sessionId))
    .orderBy(orders.createdAt)
    .limit(1);

  // 3. Items + Payments (kalau ada order)
  // pakai profile aliases supaya bisa join 2x (menu_item, added_by member)
  const itemsRaw = order
    ? await db
        .select({
          id: orderItems.id,
          quantity: orderItems.quantity,
          unit_price: orderItems.unitPrice,
          notes: orderItems.notes,
          status: orderItems.status,
          queue_number: orderItems.queueNumber,
          menu_item_name: menuItems.name,
          added_by_name: profiles.displayName,
        })
        .from(orderItems)
        .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
        .innerJoin(sessionMembers, eq(sessionMembers.id, orderItems.addedByMemberId))
        .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
        .where(
          and(eq(orderItems.orderId, order.id), sql`${orderItems.status} <> 'void'`)
        )
        .orderBy(orderItems.queueNumber)
    : [];

  const paymentsRaw = order
    ? await db
        .select({
          id: payments.id,
          amount: payments.amount,
          method: payments.method,
          status: payments.status,
          split_mode: payments.splitMode,
          paid_at: payments.paidAt,
          created_at: payments.createdAt,
          paid_by_name: profiles.displayName,
        })
        .from(payments)
        .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
        .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
        .where(eq(payments.orderId, order.id))
        .orderBy(payments.createdAt)
    : [];

  // 4. Members — daftar lengkap (host dulu, lalu member; yang joined dulu)
  const membersRaw = await db
    .select({
      profile_id: profiles.id,
      name: profiles.displayName,
      avatar: profiles.avatarUrl,
      role: sessionMembers.role,
      status: sessionMembers.status,
      is_guest: profiles.isGuest,
      // Customer terdaftar = bukan guest & bukan staff (sama kriteria Manage Customer).
      is_customer: sql<boolean>`(${profiles.isGuest} = false AND ${staffRoles.profileId} IS NULL)`,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .leftJoin(staffRoles, eq(staffRoles.profileId, profiles.id))
    .where(eq(sessionMembers.sessionId, sessionId));

  const members: TransactionDetailMember[] = membersRaw
    .map((m) => ({
      profile_id: m.profile_id,
      name: m.name,
      avatar: m.avatar,
      role: m.role,
      status: m.status,
      is_guest: m.is_guest,
      is_customer: m.is_customer,
    }))
    .sort((a, b) => {
      // Host paling atas, lalu joined sebelum left/kicked.
      if (a.role === "host" && b.role !== "host") return -1;
      if (b.role === "host" && a.role !== "host") return 1;
      if (a.status === "joined" && b.status !== "joined") return -1;
      if (b.status === "joined" && a.status !== "joined") return 1;
      return 0;
    });

  const items: TransactionDetailItem[] = itemsRaw.map((i) => ({
    id: i.id,
    quantity: i.quantity,
    unit_price: i.unit_price,
    notes: i.notes,
    status: i.status,
    queue_number: i.queue_number,
    menu_item_name: i.menu_item_name,
    added_by_name: i.added_by_name,
  }));

  // Move history — riwayat pindah meja (dari→ke), terlama dulu, utk chain.
  const ftAlias = aliasedTable(tables, "mv_from");
  const ttAlias = aliasedTable(tables, "mv_to");
  const byStaffProfile = aliasedTable(profiles, "mv_by");
  const moveRows = await db
    .select({
      id: tableMoveRequests.id,
      from_label: ftAlias.label,
      to_label: ttAlias.label,
      status: tableMoveRequests.status,
      created_at: tableMoveRequests.createdAt,
      resolved_at: tableMoveRequests.resolvedAt,
      by_staff_name: byStaffProfile.displayName,
    })
    .from(tableMoveRequests)
    .innerJoin(ftAlias, eq(ftAlias.id, tableMoveRequests.fromTableId))
    .innerJoin(ttAlias, eq(ttAlias.id, tableMoveRequests.toTableId))
    .leftJoin(byStaffProfile, eq(byStaffProfile.id, tableMoveRequests.resolvedBy))
    .where(eq(tableMoveRequests.sessionId, sessionId))
    .orderBy(tableMoveRequests.createdAt);

  // Chain pindah yg BERHASIL (approved), utk infer meja saat tiap pembayaran.
  // Tiap approved move: sebelum `resolved_at` meja = from, sesudah = to.
  const approvedMoves = moveRows
    .filter((m) => m.status === "approved")
    .map((m) => ({
      at: (m.resolved_at ?? m.created_at).getTime(),
      to: m.to_label,
    }));
  /** Meja yg berlaku pada waktu `ts` (ms): to_label dari move approved terakhir
   *  yg <= ts, else meja terkini table_label kalau belum ada move. */
  function tableAt(ts: number): string {
    let label = moveRows[0]?.from_label ?? sessionRow.table_label;
    for (const mv of approvedMoves) {
      if (mv.at <= ts) label = mv.to;
    }
    return label;
  }

  const paymentsList: TransactionDetailPayment[] = paymentsRaw.map((p) => {
    const ts = (p.paid_at ?? p.created_at).getTime();
    return {
      id: p.id,
      amount: p.amount,
      method: p.method,
      status: p.status,
      split_mode: p.split_mode,
      paid_at: p.paid_at ? p.paid_at.toISOString() : null,
      paid_by_name: p.paid_by_name,
      at_table: moveRows.length > 0 ? tableAt(ts) : null,
    };
  });

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const totalPaid = paymentsList
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  // Tax & service dari config bar → total tagihan.
  const bill = computeBillTotals(subtotal, await getChargeConfig(barId));

  const moveHistory: TransactionMoveHistory[] = moveRows.map((m) => ({
    id: m.id,
    from_label: m.from_label,
    to_label: m.to_label,
    status: m.status,
    at: (m.resolved_at ?? m.created_at).toISOString(),
    by_staff_name: m.by_staff_name,
  }));

  return {
    session_id: sessionRow.id,
    status: sessionRow.status,
    title: sessionRow.title,
    visibility: sessionRow.visibility,
    vibe_tags: sessionRow.vibe_tags ?? [],
    started_at: sessionRow.started_at.toISOString(),
    closed_at: sessionRow.closed_at ? sessionRow.closed_at.toISOString() : null,
    table_label: sessionRow.table_label,
    table_shape: sessionRow.table_shape,
    table_capacity: sessionRow.table_capacity,
    area_name: sessionRow.area_name,
    host_name: sessionRow.host_name,
    host_avatar: sessionRow.host_avatar,
    member_count: members.length,
    members,
    items,
    payments: paymentsList,
    subtotal,
    tax: bill.tax,
    service: bill.service,
    total: bill.total,
    total_paid: totalPaid,
    move_history: moveHistory,
  };
}

// ============================================================
// Date range helpers (unchanged from Phase 0 — pure TS, no DB)
// ============================================================

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "this_month"
  | "last_month"
  | "custom";

export interface DateRange {
  from: string;
  to: string;
  preset: DateRangePreset;
  label: string;
}

/**
 * Resolve preset / custom dates to actual UTC range.
 * Semua perhitungan pakai timezone Asia/Jakarta (offset +07:00).
 */
export function resolveDateRange(
  preset: DateRangePreset = "today",
  customFrom?: string,
  customTo?: string
): DateRange {
  const TZ_OFFSET_HOURS = 7;

  const nowUtc = new Date();
  const nowJkt = new Date(nowUtc.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);

  const startOfTodayJkt = new Date(
    Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), nowJkt.getUTCDate())
  );
  const startOfToday = new Date(
    startOfTodayJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000
  );

  const day = 24 * 60 * 60 * 1000;

  let from: Date;
  let to: Date;
  let label: string;

  switch (preset) {
    case "today":
      from = startOfToday;
      to = new Date(startOfToday.getTime() + day);
      label = "Hari ini";
      break;
    case "yesterday":
      from = new Date(startOfToday.getTime() - day);
      to = startOfToday;
      label = "Kemarin";
      break;
    case "last7":
      from = new Date(startOfToday.getTime() - 7 * day);
      to = new Date(startOfToday.getTime() + day);
      label = "7 hari terakhir";
      break;
    case "last30":
      from = new Date(startOfToday.getTime() - 30 * day);
      to = new Date(startOfToday.getTime() + day);
      label = "30 hari terakhir";
      break;
    case "this_month": {
      const firstJkt = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), 1)
      );
      from = new Date(firstJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000);
      to = new Date(startOfToday.getTime() + day);
      label = "Bulan ini";
      break;
    }
    case "last_month": {
      const firstThisJkt = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), 1)
      );
      const firstLastJkt = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth() - 1, 1)
      );
      from = new Date(firstLastJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000);
      to = new Date(firstThisJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000);
      label = "Bulan lalu";
      break;
    }
    case "custom":
    default: {
      const f = customFrom ? new Date(`${customFrom}T00:00:00+07:00`) : startOfToday;
      const t = customTo
        ? new Date(`${customTo}T00:00:00+07:00`)
        : new Date(startOfToday.getTime() + day);
      from = f;
      to = new Date(t.getTime() + day);
      label = `${customFrom ?? ""} → ${customTo ?? ""}`;
      break;
    }
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    preset,
    label,
  };
}
