/**
 * Server-side data fetching helpers (read queries).
 *
 * Migrated dari Supabase client ke Drizzle ORM (Phase 3).
 *
 * Return shape tetap snake_case match `@/types/db` interface supaya
 * page-page consumer tidak perlu diubah. Mapping camelCase (Drizzle)
 * → snake_case (types) terjadi di sini sebagai translation layer.
 *
 * Phase 5 cleanup nanti baru migrate types ke camelCase kalau diputuskan.
 */

import { eq, and, inArray, asc, sql, lt, lte, gt, ne, or, desc, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  areFriends,
  getBlockedIdSet,
  isBlockedEitherWay,
} from "@/lib/friends";
import {
  effectiveLevelKey,
  getEffectiveRankOf,
  MEMBERSHIP_RANK,
} from "@/lib/membership";
import { membershipLevels } from "@/lib/db/schema/membership";
import { bars, floorAreas, tables } from "@/lib/db/schema/venue";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { menuCategories, menuItems } from "@/lib/db/schema/menu";
import { profiles } from "@/lib/db/schema/profiles";
import { memberRatings } from "@/lib/db/schema/extras";
import { getChargeConfig } from "@/lib/settings-actions";
import { computeBillTotals } from "@/lib/settings-constants";
import { notifyPaymentEvent } from "@/lib/payment-notify";
import { releaseVoucherForPayment } from "@/lib/member-voucher";
import { logSystem } from "@/lib/activity-log";
import type {
  Bar,
  FloorArea,
  BarTable,
  ActiveSessionView,
  MenuCategory,
  MenuCategoryTree,
  MenuItem,
  RatableMember,
  UserRatingSummary,
  ActiveNetworkUser,
  PublicProfile,
  UserTableHistoryEntry,
  UserReviewEntry,
} from "@/types/db";

// ============================================================
// VENUE (bars, areas, tables)
// ============================================================

export async function getBarBySlug(slug: string): Promise<Bar | null> {
  const row = await db.query.bars.findFirst({
    where: eq(bars.slug, slug),
  });
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    address: row.address,
    logo_url: row.logoUrl,
    cover_url: row.coverUrl,
    theme: row.theme as Record<string, string>,
    opening_hours: row.openingHours as Record<string, string>,
    created_at: row.createdAt.toISOString(),
  };
}

export async function getFloorAreas(barId: string): Promise<FloorArea[]> {
  const rows = await db.query.floorAreas.findMany({
    where: eq(floorAreas.barId, barId),
    orderBy: asc(floorAreas.sortOrder),
  });
  return rows.map((row) => ({
    id: row.id,
    bar_id: row.barId,
    name: row.name,
    slug: row.slug,
    canvas_width: row.canvasWidth,
    canvas_height: row.canvasHeight,
    background_url: row.backgroundUrl,
    sort_order: row.sortOrder,
    created_at: row.createdAt.toISOString(),
  }));
}

/**
 * Denah lantai lengkap satu bar untuk komponen FloorMap: tiap area beserta
 * mejanya (dgn koordinat) + active_session (open/locked = sedang dipakai).
 * Dipakai halaman customer (via bar/[slug]) DAN pemilih meja walk-in staff,
 * supaya dua tempat memakai bentuk data yang sama persis.
 *
 * active_session di sini = KONDISI SEKARANG saja (open/locked). Reservasi
 * (future booking) TIDAK mewarnai meja — sama seperti perilaku denah customer.
 */
export async function getFloorMapForBar(barId: string): Promise<
  Array<{ area: FloorArea; tables: (BarTable & { active_session: ActiveSessionView | null })[] }>
> {
  const areas = await getFloorAreas(barId);
  return Promise.all(
    areas.map(async (area) => {
      const [tables, sessions] = await Promise.all([
        getTablesByArea(area.id),
        getActiveSessionsForArea(area.id),
      ]);
      const tablesWithSession = tables.map((t) => {
        const active =
          sessions.find(
            (s) =>
              s.table_id === t.id &&
              (s.status === "open" || s.status === "locked")
          ) ?? null;
        return { ...t, active_session: active };
      });
      return { area, tables: tablesWithSession };
    })
  );
}

export async function getTablesByArea(areaId: string): Promise<BarTable[]> {
  const rows = await db.query.tables.findMany({
    // Customer: hanya meja aktif & sudah publish (bukan draft).
    where: and(
      eq(tables.areaId, areaId),
      eq(tables.isActive, true),
      eq(tables.isDraft, false)
    ),
    orderBy: asc(tables.label),
  });
  return rows.map((row) => ({
    id: row.id,
    area_id: row.areaId,
    label: row.label,
    shape: row.shape,
    capacity: row.capacity,
    pos_x: row.posX,
    pos_y: row.posY,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    is_active: row.isActive,
    min_spend: row.minSpend,
    created_at: row.createdAt.toISOString(),
  }));
}

/**
 * Tables untuk floor EDITOR (admin): sertakan draft posisi. pos_x/pos_y di sini
 * = draft kalau ada (supaya editor lanjut dari posisi draft terakhir), draft_*
 * = nilai mentah untuk tahu apakah ada perubahan belum di-publish.
 */
export async function getTablesByAreaForEditor(
  areaId: string
): Promise<BarTable[]> {
  const rows = await db.query.tables.findMany({
    where: eq(tables.areaId, areaId),
    orderBy: asc(tables.label),
  });
  return rows.map((row) => ({
    id: row.id,
    area_id: row.areaId,
    label: row.label,
    shape: row.shape,
    capacity: row.capacity,
    // Editor lanjut dari draft kalau ada.
    pos_x: row.draftPosX ?? row.posX,
    pos_y: row.draftPosY ?? row.posY,
    draft_pos_x: row.draftPosX,
    draft_pos_y: row.draftPosY,
    is_draft: row.isDraft,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    is_active: row.isActive,
    min_spend: row.minSpend,
    allow_over_capacity: row.allowOverCapacity,
    created_at: row.createdAt.toISOString(),
  }));
}

// ============================================================
// ACTIVE SESSIONS (replaces v_active_sessions view)
// ============================================================

/**
 * Query v_active_sessions equivalent: join table_sessions + tables + areas + host profile,
 * filter status 'open' atau 'locked', filter by bar via area→bar relation.
 *
 * member_count di-compute via subquery COUNT.
 */
async function activeSessionsBase(): Promise<
  (ActiveSessionView & { bar_id: string })[]
> {
  // Subquery untuk member count
  const memberCountSq = db
    .select({
      sessionId: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`.as("member_count"),
    })
    .from(sessionMembers)
    .where(eq(sessionMembers.status, "joined"))
    .groupBy(sessionMembers.sessionId)
    .as("mc");

  const rows = await db
    .select({
      id: tableSessions.id,
      table_id: tableSessions.tableId,
      table_label: tables.label,
      area_id: tables.areaId,
      area_name: floorAreas.name,
      status: tableSessions.status,
      visibility: tableSessions.visibility,
      title: tableSessions.title,
      vibe_tags: tableSessions.vibeTags,
      host_id: tableSessions.hostId,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
      started_at: tableSessions.startedAt,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      member_count: sql<number>`COALESCE(${memberCountSq.count}, 0)::int`,
      table_capacity: tables.capacity,
      bar_id: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .leftJoin(memberCountSq, eq(memberCountSq.sessionId, tableSessions.id))
    .where(
      inArray(tableSessions.status, ["reserved", "open", "locked", "overdue"])
    );

  return rows.map((r) => ({
    ...r,
    started_at: r.started_at.toISOString(),
    reservation_at: r.reservation_at ? r.reservation_at.toISOString() : null,
    reservation_end_at: r.reservation_end_at
      ? r.reservation_end_at.toISOString()
      : null,
  }));
}

export async function getActiveSessionsByBar(
  barId: string
): Promise<ActiveSessionView[]> {
  const all = await activeSessionsBase();
  return all.filter((s) => s.bar_id === barId).map(({ bar_id: _b, ...rest }) => rest);
}

/**
 * Set sessionId yang DIIKUTI profil ini (status 'joined') — dipakai feed
 * "Live now" untuk menandai meja mana yang ada dirinya. Dipisah dari
 * activeSessionsBase() supaya query bersama (denah, area) tak ikut terbebani
 * dan hasilnya tetap bisa di-cache per-user di pemanggil.
 */
export async function getJoinedSessionIds(
  profileId: string,
  sessionIds: string[]
): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const rows = await db
    .select({ sessionId: sessionMembers.sessionId })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.profileId, profileId),
        eq(sessionMembers.status, "joined"),
        inArray(sessionMembers.sessionId, sessionIds)
      )
    );
  return new Set(rows.map((r) => r.sessionId));
}

export async function getActiveSessionsForArea(
  areaId: string
): Promise<ActiveSessionView[]> {
  const all = await activeSessionsBase();
  return all.filter((s) => s.area_id === areaId).map(({ bar_id: _b, ...rest }) => rest);
}

/**
 * Tutup session yang sudah selesai (lazy, dipanggil saat floor di-load):
 * - Session hasil reservasi (punya reservation_end_at): close kalau
 *   reservation_end_at <= now. Meja jadi available (atau reserved kalau ada
 *   booking berikutnya yg belum due — itu tetap 'reserved' di tabel).
 * - Walk-in basi (reservation_at NULL, open): close kalau started_at sudah
 *   lebih dari WALKIN_MAX_HOURS jam lalu (sisa sesi yg lupa ditutup).
 *
 * Return jumlah session yang di-close.
 */
const WALKIN_MAX_HOURS = 12;

/**
 * Map sessionId → outstanding (sisa tagihan) = subtotal order_items non-void −
 * total payments berstatus 'paid'. Hanya untuk sessionIds yang diberikan.
 * Session tanpa order dianggap outstanding 0. Reuse pola cashier-actions.
 */
export async function getOutstandingMap(
  sessionIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sessionIds.length === 0) return out;

  // Subtotal per sesi + bar-nya (utk chargeConfig tax/service).
  const bills = await db
    .select({
      session_id: orders.sessionId,
      bar_id: floorAreas.barId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .leftJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
    )
    // Order 'cancelled' TAK PERNAH jadi tagihan. Pertahanan berlapis: item
    // order batal semestinya sudah di-void, tapi kalau ada satu jalur yg lupa
    // (pernah terjadi), tanpa filter ini hasilnya tagihan hantu yg bikin meja
    // tak bisa ditutup. Agregat staff sudah punya penjagaan serupa.
    .where(
      and(
        inArray(orders.sessionId, sessionIds),
        ne(orders.status, "cancelled")
      )
    )
    .groupBy(orders.sessionId, floorAreas.barId);

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

  // Cache chargeConfig per bar (biasanya cuma 1 bar — single-tenant).
  const chargeByBar = new Map<
    string,
    Awaited<ReturnType<typeof getChargeConfig>>
  >();
  const paidMap = new Map(paidRows.map((r) => [r.session_id, Number(r.paid)]));
  for (const b of bills) {
    let charge = chargeByBar.get(b.bar_id);
    if (!charge) {
      charge = await getChargeConfig(b.bar_id);
      chargeByBar.set(b.bar_id, charge);
    }
    const bill = computeBillTotals(Number(b.subtotal), charge);
    const outstanding = Math.max(
      0,
      bill.total - (paidMap.get(b.session_id) ?? 0)
    );
    out.set(b.session_id, outstanding);
  }
  return out;
}

/**
 * Outstanding untuk SATU order (multi-order model). Total order (subtotal item
 * non-void + tax/service) − Σ(payment lunas order itu). Order 'paid'/lunas = 0.
 * (PRD Multi-Order Prepaid.)
 */
export async function getOrderOutstanding(orderId: string): Promise<{
  subtotal: number;
  total: number;
  paid: number;
  outstanding: number;
}> {
  const [row] = await db
    .select({
      barId: floorAreas.barId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .leftJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
    )
    .where(eq(orders.id, orderId))
    .groupBy(floorAreas.barId);
  if (!row) return { subtotal: 0, total: 0, paid: 0, outstanding: 0 };

  const [paidRow] = await db
    .select({
      paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "paid")));

  const charge = await getChargeConfig(row.barId);
  const bill = computeBillTotals(Number(row.subtotal), charge);
  const paid = Number(paidRow?.paid ?? 0);
  return {
    subtotal: bill.subtotal,
    total: bill.total,
    paid,
    outstanding: Math.max(0, bill.total - paid),
  };
}

/**
 * Prepaid hook: kalau order berstatus 'unpaid' dan sudah lunas (untuk order DP,
 * cukup DP lunas — Q7), maka order "MASUK": status → 'paid', paid_at di-set, dan
 * item order (status 'draft') diubah 'sent' (masuk antrian dapur).
 * Dipanggil setelah tiap pembayaran lunas. Return true kalau order baru "masuk".
 * (PRD Multi-Order Prepaid FR7.)
 */
export async function settleOrderIfPaid(orderId: string): Promise<boolean> {
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      sessionId: orders.sessionId,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order || order.status === "cancelled") return false;

  // Order dianggap "masuk" kalau ada DP lunas (order DP) ATAU lunas penuh.
  // Cek: ada payment lunas utk order ini? (DP lunas sudah cukup — Q7.)
  const [paidRow] = await db
    .select({ paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "paid")));
  const paid = Number(paidRow?.paid ?? 0);
  if (paid <= 0) return false; // belum ada pembayaran lunas → belum masuk.

  const now = new Date();
  let entered = false;
  if (order.status === "unpaid") {
    await db
      .update(orders)
      .set({ status: "paid", paidAt: now })
      .where(eq(orders.id, orderId));
    // Item draft → sent (masuk dapur).
    await db
      .update(orderItems)
      .set({ status: "sent" })
      .where(
        and(eq(orderItems.orderId, orderId), eq(orderItems.status, "draft"))
      );
    entered = true;
  }

  // ---- Rekonsiliasi "Pay on Cashier" (jalan juga utk order yg SUDAH paid) ----
  // Kasir sering menerima uang lewat alur "terima pembayaran" biasa alih-alih
  // mark-paid baris pending pay-at-cashier → baris itu menggantung selamanya
  // ("waiting confirmation" padahal sudah dibayar). Dua langkah:

  // (1) DP menggantung: uang diterima ≥ nominal DP → booking terkonfirmasi
  //     (dp_paid_at di-set) + baris DP pending dimatikan. Tanpa ini, timeout
  //     DP membatalkan booking yang SUDAH dibayar. Harus jalan SEBELUM (2)
  //     supaya dp_paid_at tetap ter-set saat barisnya ikut ter-supersede.
  const [sess] = await db
    .select({ dpPaidAt: tableSessions.dpPaidAt })
    .from(tableSessions)
    .where(eq(tableSessions.id, order.sessionId));
  if (sess && sess.dpPaidAt == null) {
    const [danglingDp] = await db
      .select({ id: payments.id, amount: payments.amount })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.status, "pending"),
          sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
        )
      )
      .limit(1);
    if (danglingDp && paid >= danglingDp.amount) {
      const superseded = await db
        .update(payments)
        .set({
          status: "failed",
          paidAt: null,
          // Penanda utk UI: baris ini DIGANTIKAN pembayaran lain (bukan batal
          // biasa) — tampil "Replaced", bukan "Cancelled".
          splitMeta: sql`${payments.splitMeta} || '{"supersededByPaid": true}'::jsonb`,
        })
        .where(
          and(eq(payments.id, danglingDp.id), eq(payments.status, "pending"))
        )
        .returning({ id: payments.id });
      if (superseded.length > 0) {
        await releaseVoucherForPayment(danglingDp.id).catch(() => {});
        await db
          .update(tableSessions)
          .set({ dpPaidAt: now })
          .where(eq(tableSessions.id, order.sessionId));
      }
    }
  }

  // (2) Tagihan order sudah TERTUTUP (outstanding ≤ 0) → semua pending
  //     pay-at-cashier di order ini tak lagi diperlukan; matikan (conditional)
  //     supaya tak ada baris "waiting confirmation" menggantung. QRIS pending
  //     TIDAK disentuh — QR-nya masih hidup di gateway (paidAfterCancelled
  //     menangani kalau tetap terbayar).
  const { outstanding } = await getOrderOutstanding(orderId);
  if (outstanding <= 0) {
    const danglingCashier = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.status, "pending"),
          sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`
        )
      );
    for (const d of danglingCashier) {
      const upd = await db
        .update(payments)
        .set({
          status: "failed",
          paidAt: null,
          splitMeta: sql`${payments.splitMeta} || '{"supersededByPaid": true}'::jsonb`,
        })
        .where(and(eq(payments.id, d.id), eq(payments.status, "pending")))
        .returning({ id: payments.id });
      if (upd.length > 0) {
        await releaseVoucherForPayment(d.id).catch(() => {});
      }
    }
  }

  return entered;
}

/**
 * Kalau session berstatus 'overdue' dan tagihannya sudah lunas (outstanding
 * <= 0), tutup jadi 'closed'. Dipanggil setelah pembayaran berhasil (payShare /
 * cashier mark-paid). No-op kalau session bukan overdue atau masih ada sisa.
 */
export interface UnpaidSessionView {
  id: string;
  table_label: string;
  area_name: string;
  bar_name: string;
  status: string;
  started_at: string;
  outstanding: number;
}

/**
 * Sesi yang DIIKUTI user (host atau member non-pending) dan masih punya tagihan
 * belum lunas (outstanding > 0). Mencakup status 'overdue' (lewat waktu tapi
 * nunggak) maupun 'closed' yang di-close paksa dengan sisa. Dipakai untuk banner
 * "tagihan belum lunas" + badge riwayat. Dibatasi 60 hari terakhir.
 */
export async function getUnpaidSessionsForProfile(
  profileId: string
): Promise<UnpaidSessionView[]> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const rows = await db
    .selectDistinct({
      id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      bar_name: bars.name,
      status: tableSessions.status,
      started_at: tableSessions.startedAt,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .leftJoin(
      sessionMembers,
      and(
        eq(sessionMembers.sessionId, tableSessions.id),
        eq(sessionMembers.profileId, profileId)
      )
    )
    .where(
      and(
        inArray(tableSessions.status, ["overdue", "closed"]),
        gt(tableSessions.startedAt, since),
        or(
          eq(tableSessions.hostId, profileId),
          and(
            eq(sessionMembers.profileId, profileId),
            ne(sessionMembers.status, "pending")
          )
        )
      )
    )
    .orderBy(desc(tableSessions.startedAt))
    .limit(50);

  if (rows.length === 0) return [];
  const outMap = await getOutstandingMap(rows.map((r) => r.id));
  return rows
    .map((r) => ({
      id: r.id,
      table_label: r.table_label,
      area_name: r.area_name,
      bar_name: r.bar_name,
      status: r.status as string,
      started_at: r.started_at.toISOString(),
      outstanding: outMap.get(r.id) ?? 0,
    }))
    .filter((r) => r.outstanding > 0);
}

export async function settleOverdueIfPaid(sessionId: string): Promise<boolean> {
  const [s] = await db
    .select({ status: tableSessions.status })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!s || s.status !== "overdue") return false;

  const outstanding = (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
  if (outstanding > 0) return false;

  await db
    .update(tableSessions)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(tableSessions.id, sessionId));
  return true;
}

/** Batas waktu bayar DP booking via QRIS (detik). Lewat ini → booking batal. */
export const DP_TIMEOUT_SECONDS = 60;

/**
 * Batas konfirmasi DP "Pay at cashier" (detik) — 10 menit. Customer harus
 * datang & bayar ke kasir dalam waktu ini; lewat → booking dibatalkan dan
 * slot mejanya bebas lagi (arahan user, fitur Pay on Cashier).
 */
export const PAY_AT_CASHIER_TIMEOUT_SECONDS = 10 * 60;

/**
 * DP "pay at cashier" yang masih pending untuk sesi-sesi tertentu yang HOST-nya
 * = profileId (viewer). Dipakai menampilkan arahan "segera ke kasir" + countdown
 * di Booking Schedule / Home — hanya untuk booking milik user sendiri.
 * Return Map<sessionId, { order_id, expires_at }>. Kosong kalau tak ada.
 */
export async function getViewerPayAtCashierDp(
  sessionIds: string[],
  profileId: string
): Promise<Map<string, { order_id: string; expires_at: string | null }>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .select({
      session_id: orders.sessionId,
      order_id: orders.id,
      split_meta: payments.splitMeta,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .where(
      and(
        inArray(orders.sessionId, sessionIds),
        eq(tableSessions.hostId, profileId),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`,
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`
      )
    );
  return new Map(
    rows.map((r) => {
      const meta = (r.split_meta ?? {}) as { expiresAt?: string | null };
      return [
        r.session_id,
        { order_id: r.order_id, expires_at: meta.expiresAt ?? null },
      ];
    })
  );
}

/** Pembayaran "pay at cashier" milik user yang menunggu konfirmasi (banner home).
 *  kind 'dp' = DP booking (→ /booking/[id]/pay); 'order' = order meja aktif
 *  (→ /session/[id]/order/[orderId]/pay). */
export interface PendingCashierBooking {
  kind: "dp" | "order";
  session_id: string;
  order_id: string;
  table_label: string;
  amount: number;
  reservation_at: string | null;
  expires_at: string | null;
}

/**
 * Booking milik profileId (sebagai host) yang status 'reserved' dengan DP
 * "pay at cashier" masih pending — untuk banner "segera ke kasir" di home.
 * Terbaru dulu. Kosong kalau tak ada.
 */
export async function getPendingCashierBookingsForProfile(
  profileId: string
): Promise<PendingCashierBooking[]> {
  const rows = await db
    .select({
      session_id: tableSessions.id,
      order_id: orders.id,
      table_label: tables.label,
      amount: payments.amount,
      reservation_at: tableSessions.reservationAt,
      split_meta: payments.splitMeta,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(tableSessions.hostId, profileId),
        eq(tableSessions.status, "reserved"),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`,
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`
      )
    )
    .orderBy(desc(tableSessions.reservationAt));

  // Query kedua: ORDER MEJA AKTIF (non-DP) yg dibayar user (sbg PEMBAYAR, bukan
  // harus host) via pay-at-cashier & masih pending. paidByMemberId → member →
  // profile. Sesi 'open'/'locked'.
  const orderRows = await db
    .select({
      session_id: tableSessions.id,
      order_id: orders.id,
      table_label: tables.label,
      amount: payments.amount,
      split_meta: payments.splitMeta,
      created_at: payments.createdAt,
    })
    .from(payments)
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(sessionMembers.profileId, profileId),
        inArray(tableSessions.status, ["open", "locked"]),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`,
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS NOT TRUE`
      )
    )
    .orderBy(desc(payments.createdAt));

  const dpItems: PendingCashierBooking[] = rows.map((r) => {
    const meta = (r.split_meta ?? {}) as { expiresAt?: string | null };
    return {
      kind: "dp" as const,
      session_id: r.session_id,
      order_id: r.order_id,
      table_label: r.table_label,
      amount: r.amount,
      reservation_at: r.reservation_at
        ? r.reservation_at.toISOString()
        : null,
      expires_at: meta.expiresAt ?? null,
    };
  });
  const orderPayItems: PendingCashierBooking[] = orderRows.map((r) => {
    const meta = (r.split_meta ?? {}) as { expiresAt?: string | null };
    return {
      kind: "order" as const,
      session_id: r.session_id,
      order_id: r.order_id,
      table_label: r.table_label,
      amount: r.amount,
      reservation_at: null,
      expires_at: meta.expiresAt ?? null,
    };
  });
  return [...dpItems, ...orderPayItems];
}

/**
 * Batalkan booking yang DP-nya tak dibayar dalam batas waktunya.
 * Batas per payment: splitMeta.expiresAt kalau ada (QRIS gateway / pay-at-
 * cashier 10 menit), fallback created_at + DP_TIMEOUT_SECONDS.
 * Kondisi: session 'reserved', dp_paid_at NULL, punya payment DP (isDownPayment)
 * pending yang sudah lewat batas → set payment 'failed' + session 'cancelled'.
 * Return true kalau session ini dibatalkan.
 * Lazy: dipanggil saat buka /session, load denah, dashboard kasir, atau saat
 * countdown habis.
 */
export async function expireDpIfOverdue(sessionId: string): Promise<boolean> {
  const [s] = await db
    .select({
      status: tableSessions.status,
      dpPaidAt: tableSessions.dpPaidAt,
    })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  // DP belum lunas & booking belum final (reserved/open). 'open' bisa terjadi
  // kalau booking sempat ke-promote sebelum fix — tetap batalkan kalau DP basi.
  if (
    !s ||
    (s.status !== "reserved" && s.status !== "open") ||
    s.dpPaidAt != null
  )
    return false;

  // Cari payment DP pending sesi ini, evaluasi deadline-nya di kode (meta
  // expiresAt beda-beda per metode: QRIS 60 dtk, pay-at-cashier 10 menit).
  const [dp] = await db
    .select({
      id: payments.id,
      createdAt: payments.createdAt,
      splitMeta: payments.splitMeta,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(orders.sessionId, sessionId),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
      )
    )
    .limit(1);
  if (!dp) return false;

  const meta = (dp.splitMeta ?? {}) as { expiresAt?: string | null };
  const deadlineMs = meta.expiresAt
    ? new Date(meta.expiresAt).getTime()
    : dp.createdAt.getTime() + DP_TIMEOUT_SECONDS * 1000;
  if (Date.now() <= deadlineMs) return false;

  // Batalkan: payment gagal + session cancelled (meja bebas lagi). Transisi
  // conditional (WHERE pending) — kalau kasir keburu konfirmasi di sela ini,
  // jangan menimpa 'paid'.
  const cancelled = await db
    .update(payments)
    .set({ status: "failed", paidAt: null })
    .where(and(eq(payments.id, dp.id), eq(payments.status, "pending")))
    .returning({ id: payments.id });
  if (cancelled.length === 0) return false;
  // Voucher benefit yang menempel di DP ini → lepas lagi (bisa dipakai ulang).
  await releaseVoucherForPayment(dp.id).catch(() => {});
  await db
    .update(tableSessions)
    .set({ status: "cancelled", closedAt: new Date() })
    .where(eq(tableSessions.id, sessionId));
  // Notif gagal ke host/pembayar/staff (best-effort, tak blokir sweep).
  await notifyPaymentEvent(dp.id, "cancelled");
  return true;
}

/**
 * Lazy-expire pembayaran "pay at cashier" untuk ORDER MEJA AKTIF (bukan DP
 * booking) yang lewat batas (splitMeta.expiresAt, 10 menit). Beda dari booking:
 * MEJA TIDAK dibebaskan — tamu masih duduk. Yang dibatalkan HANYA order/pembayaran
 * itu:
 *  - payment pending pay-at-cashier (isDownPayment != true) yg expiresAt < now
 *    → status 'failed'.
 *  - kalau ordernya masih 'unpaid' (prepaid, belum ada uang masuk) → void item +
 *    order 'cancelled' (sama pola expireUnpaidMemberOrders). Kalau order sudah
 *    'paid' (bayar sisa bill) → item TAK disentuh, cukup gagalkan pembayarannya.
 * Dipanggil lazy saat load: dashboard kasir, halaman order, home.
 * Return jumlah payment yang di-expire.
 */
export async function expireOverduePayAtCashierOrders(
  barId: string
): Promise<number> {
  // Payment pending pay-at-cashier NON-DP di sesi 'open'/'locked' bar ini yg
  // sudah lewat expiresAt.
  const overdue = await db
    .select({ paymentId: payments.id, orderId: orders.id })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        inArray(tableSessions.status, ["open", "locked"]),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`,
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS NOT TRUE`,
        sql`(${payments.splitMeta} ->> 'expiresAt')::timestamptz < now()`
      )
    );
  if (overdue.length === 0) return 0;

  const payIds = overdue.map((o) => o.paymentId);
  const orderIds = Array.from(new Set(overdue.map((o) => o.orderId)));
  let expired = 0;
  await db.transaction(async (tx) => {
    // Gagalkan pembayaran (kondisional: jangan timpa kalau keburu paid/failed).
    const failed = await tx
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(and(inArray(payments.id, payIds), eq(payments.status, "pending")))
      .returning({ id: payments.id });
    expired = failed.length;
    if (expired === 0) return;
    // Order yang masih 'unpaid' (prepaid, belum masuk dapur) → void item +
    // cancel. Order 'paid' (bayar sisa bill) tak disentuh — itemnya sah.
    await tx
      .update(orderItems)
      .set({ status: "void" })
      .where(
        and(
          inArray(orderItems.orderId, orderIds),
          eq(orderItems.status, "draft")
        )
      );
    await tx
      .update(orders)
      .set({ status: "cancelled", closedAt: new Date() })
      .where(and(inArray(orders.id, orderIds), eq(orders.status, "unpaid")));
  });
  // Lepas voucher yg menempel + notif gagal (best-effort, di luar tx).
  for (const p of payIds) {
    await releaseVoucherForPayment(p).catch(() => {});
    await notifyPaymentEvent(p, "cancelled").catch(() => {});
  }

  // Audit: satu baris ringkas per sweep, BUKAN per pembayaran — fungsi ini
  // dipanggil lazy tiap load halaman, jadi mencatat per item akan membanjiri
  // log. Yang penting bagi admin: ada tagihan gagal karena lewat waktu.
  if (expired > 0) {
    await logSystem({
      barId,
      action: "payment.expired",
      category: "payment",
      entityType: "payment",
      summary: `${expired} "pay at cashier" charge(s) expired`,
      meta: { count: expired, paymentIds: payIds },
    });
  }
  return expired;
}

/**
 * Sweep semua DP booking basi di satu bar → batalkan. Deadline per payment
 * dievaluasi di expireDpIfOverdue (QRIS 60 dtk / pay-at-cashier 10 menit).
 * Dipanggil saat denah bar / dashboard kasir di-load supaya meja bebas lagi
 * walau host tak balik.
 */
export async function expireOverdueDpBookings(barId: string): Promise<number> {
  // Sesi 'reserved' di bar ini, dp belum dibayar, punya DP pending.
  const rows = await db
    .selectDistinct({ sessionId: tableSessions.id })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(orders, eq(orders.sessionId, tableSessions.id))
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(
      and(
        eq(floorAreas.barId, barId),
        inArray(tableSessions.status, ["reserved", "open"]),
        sql`${tableSessions.dpPaidAt} IS NULL`,
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
      )
    );
  let n = 0;
  for (const r of rows) {
    if (await expireDpIfOverdue(r.sessionId)) n++;
  }
  return n;
}

/**
 * True kalau session ini punya DP booking yang BELUM lunas (dp_paid_at NULL &
 * ada payment DP pending). Selama true, booking TAK BOLEH dipromote jadi 'open'
 * walau jamnya sudah tiba — DP adalah syarat konfirmasi. (Kalau sudah lewat
 * batas, expireDpIfOverdue akan membatalkannya lebih dulu.)
 */
export async function hasUnpaidDp(sessionId: string): Promise<boolean> {
  const [s] = await db
    .select({ dpPaidAt: tableSessions.dpPaidAt })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!s || s.dpPaidAt != null) return false;
  const [dp] = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(orders.sessionId, sessionId),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
      )
    )
    .limit(1);
  return !!dp;
}

/**
 * Batas hidup order milik ANGGOTA yang belum dibayar. Aturan "wajib langsung
 * bayar": kalau QRIS-nya kedaluwarsa / ditinggal, ordernya dibatalkan supaya
 * meja bersih & anggota bisa memesan lagi. Diberi kelonggaran di atas masa
 * hidup QRIS (5 menit) supaya pembayaran yang lambat ter-settle tak terpotong.
 */
const MEMBER_ORDER_GRACE_MINUTES = 15;

/**
 * Batalkan order milik ANGGOTA yang tak kunjung dibayar (lazy, tanpa cron —
 * dipanggil saat halaman sesi dibuka).
 *
 * TIDAK PERNAH membatalkan:
 * - order MEJA (owner NULL) — itu tagihan host, ditangani alur overdue biasa;
 * - order yang SUDAH ada uang masuk (pembayaran lunas apa pun, termasuk
 *   sebagian) — uang selalu lebih penting; biar kasir yang menyelesaikan;
 * - order yang masih punya QRIS pending BELUM kedaluwarsa — masih ditunggu.
 *
 * Item order masih 'draft' (belum masuk dapur), jadi pembatalan tak
 * meninggalkan pesanan yang terlanjur dimasak.
 */
export async function expireUnpaidMemberOrders(
  sessionId: string
): Promise<number> {
  const cutoff = new Date(
    Date.now() - MEMBER_ORDER_GRACE_MINUTES * 60 * 1000
  );
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.sessionId, sessionId),
        eq(orders.status, "unpaid"),
        isNotNull(orders.ownerMemberId),
        // Pakai lt() (bukan sql``) supaya Drizzle mengikat Date sesuai tipe
        // kolom timestamptz. Di sql`` mentah, Date ikut sebagai string JS
        // ("Mon Jul 20 2026 …") dan Postgres menolaknya.
        lt(orders.createdAt, cutoff),
        // Belum ada uang masuk sama sekali.
        sql`NOT EXISTS (
          SELECT 1 FROM ${payments}
          WHERE ${payments.orderId} = ${orders.id}
            AND ${payments.status} = 'paid'
        )`,
        // Tak ada QRIS pending yang masih hidup (belum lewat expiresAt).
        sql`NOT EXISTS (
          SELECT 1 FROM ${payments}
          WHERE ${payments.orderId} = ${orders.id}
            AND ${payments.status} = 'pending'
            AND COALESCE((${payments.splitMeta} ->> 'expiresAt')::timestamptz, 'infinity') > now()
        )`
      )
    );
  if (stale.length === 0) return 0;

  const ids = stale.map((o) => o.id);
  await db.transaction(async (tx) => {
    // Matikan QRIS pending yg sudah kedaluwarsa (kalau ada) supaya tak ada
    // baris menggantung di riwayat pembayaran.
    await tx
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(
        and(inArray(payments.orderId, ids), eq(payments.status, "pending"))
      );
    // Void semua itemnya — WAJIB, sama seperti cancelUnpaidOrder. Tanpa ini
    // item tetap 'draft' dan getOutstandingMap (yg hanya menyaring item void,
    // bukan status order) tetap menghitungnya: meja punya TAGIHAN HANTU,
    // tak bisa ditutup, dan host dianggap berutang atas pesanan yg dibatalkan.
    await tx
      .update(orderItems)
      .set({ status: "void" })
      .where(inArray(orderItems.orderId, ids));
    await tx
      .update(orders)
      .set({ status: "cancelled", closedAt: new Date() })
      // Kondisional: jangan batalkan kalau statusnya sudah berubah di sela ini
      // (mis. pembayaran masuk tepat saat kita jalan).
      .where(and(inArray(orders.id, ids), eq(orders.status, "unpaid")));
  });
  return ids.length;
}

export async function expireFinishedSessions(barId: string): Promise<number> {
  const now = new Date();
  const walkinCutoff = new Date(now.getTime() - WALKIN_MAX_HOURS * 60 * 60 * 1000);

  // Ambil semua session aktif (reserved/open/locked) milik bar ini.
  const active = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      startedAt: tableSessions.startedAt,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        // Termasuk 'overdue' (data lama) supaya ikut di-close — overdue tak
        // dipakai lagi sbg status auto-expire.
        inArray(tableSessions.status, ["reserved", "open", "locked", "overdue"])
      )
    );

  // Kandidat yg waktunya habis (reservasi lewat / walk-in basi / overdue lama).
  const expiring = active.filter((s) => {
    const reservationEnded =
      !!s.reservationEndAt && s.reservationEndAt.getTime() <= now.getTime();
    const staleWalkIn =
      s.status !== "reserved" &&
      !s.reservationAt &&
      s.startedAt.getTime() <= walkinCutoff.getTime();
    // Reservasi LAMA tanpa reservation_end_at (data sebelum field ini ada, atau
    // reservasi tak lengkap): tak tertangkap reservationEnded (butuh endAt) &
    // tak tertangkap staleWalkIn (punya reservationAt) → BOCOR selamanya di tab
    // Aktif. Jaring pengaman: kalau reservationAt-nya sendiri sudah lewat batas
    // basi (>12 jam lalu) & belum ada endAt, anggap selesai.
    const staleReservationNoEnd =
      !!s.reservationAt &&
      !s.reservationEndAt &&
      s.reservationAt.getTime() <= walkinCutoff.getTime();
    return reservationEnded || staleWalkIn || staleReservationNoEnd;
  });
  if (expiring.length === 0) return 0;

  // Lewat jam selesai = meja tidak aktif lagi → SELALU 'closed' (meja bebas,
  // hilang dari Meja Aktif). Sisa tagihan (kalau ada) tidak hilang: tetap bisa
  // ditagih di tab "Selesai" (fitur bayar-sisa sesi closed). Status 'overdue'
  // tak dipakai lagi untuk auto-expire.
  let processed = 0;
  for (const s of expiring) {
    await db
      .update(tableSessions)
      .set({ status: "closed", closedAt: now })
      .where(eq(tableSessions.id, s.id));
    processed++;
  }
  return processed;
}

/**
 * Promote reservasi yang waktunya SUDAH TIBA (reservation_at <= now dan
 * reservation_end_at > now) dari status 'reserved' → 'open'. Dipanggil lazy
 * saat floor view di-load (tanpa cron). Meja yang sudah punya session
 * open/locked lain tidak dipromote (cegah konflik unique index).
 *
 * Return jumlah session yang dipromote.
 */
export async function promoteDueReservations(barId: string): Promise<number> {
  const now = new Date();
  // Cari reservasi due milik bar ini, yang mejanya belum punya session
  // open/locked aktif.
  const due = await db
    .select({ id: tableSessions.id, tableId: tableSessions.tableId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        eq(tableSessions.status, "reserved"),
        lte(tableSessions.reservationAt, now),
        gt(tableSessions.reservationEndAt, now)
      )
    );
  if (due.length === 0) return 0;

  let promoted = 0;
  for (const r of due) {
    // Skip kalau meja sudah punya session open/locked lain.
    const [busy] = await db
      .select({ id: tableSessions.id })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tableId, r.tableId),
          inArray(tableSessions.status, ["open", "locked"])
        )
      );
    if (busy) continue;
    // DP belum lunas → jangan promote (booking belum terkonfirmasi).
    if (await hasUnpaidDp(r.id)) continue;
    try {
      await db
        .update(tableSessions)
        .set({ status: "open", startedAt: now })
        .where(eq(tableSessions.id, r.id));
      promoted++;
    } catch {
      // Konflik unique index (race) — abaikan, biar tetap reserved.
    }
  }
  return promoted;
}

/**
 * Promote SATU sesi reservasi spesifik kalau waktunya sudah tiba (reserved &
 * reservation_at <= now < reservation_end_at) & mejanya belum dipakai sesi
 * open/locked/overdue lain. Dipakai saat buka /session/[id] supaya status fresh
 * (denah & tombol gabung bergantung status 'open') tanpa harus reload denah.
 * Return true kalau ter-promote.
 */
export async function promoteSessionIfDue(sessionId: string): Promise<boolean> {
  const now = new Date();
  const [s] = await db
    .select({
      id: tableSessions.id,
      tableId: tableSessions.tableId,
      status: tableSessions.status,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
    })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (
    !s ||
    s.status !== "reserved" ||
    !s.reservationAt ||
    !s.reservationEndAt ||
    s.reservationAt.getTime() > now.getTime() ||
    s.reservationEndAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  // DP belum lunas → JANGAN promote. Booking DP baru terkonfirmasi setelah DP
  // dibayar; sebelum itu meja tetap 'reserved' (atau dibatalkan kalau timeout).
  if (await hasUnpaidDp(sessionId)) return false;
  // Meja dipakai sesi aktif lain (open/locked)? jangan promote (cegah konflik
  // index). 'overdue' TIDAK menghalangi — itu hutang lama, bukan okupansi fisik.
  const [busy] = await db
    .select({ id: tableSessions.id })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tableId, s.tableId),
        inArray(tableSessions.status, ["open", "locked"])
      )
    );
  if (busy) return false;
  try {
    await db
      .update(tableSessions)
      .set({ status: "open", startedAt: now })
      .where(
        and(eq(tableSessions.id, sessionId), eq(tableSessions.status, "reserved"))
      );
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// MENU
// ============================================================

export async function getMenuByBar(
  barId: string
): Promise<MenuCategoryTree[]> {
  const categories = await db.query.menuCategories.findMany({
    where: and(eq(menuCategories.barId, barId), eq(menuCategories.isActive, true)),
    orderBy: asc(menuCategories.sortOrder),
  });

  if (categories.length === 0) return [];

  const items = await db.query.menuItems.findMany({
    where: inArray(
      menuItems.categoryId,
      categories.map((c) => c.id)
    ),
    orderBy: asc(menuItems.sortOrder),
  });

  const toCat = (cat: (typeof categories)[number]): MenuCategory => ({
    id: cat.id,
    bar_id: cat.barId,
    parent_id: cat.parentId ?? null,
    name: cat.name,
    slug: cat.slug,
    sort_order: cat.sortOrder,
    is_active: cat.isActive,
    created_at: cat.createdAt.toISOString(),
  });
  const itemsOf = (categoryId: string): MenuItem[] =>
    items
      .filter((i) => i.categoryId === categoryId)
      .map((i) => ({
        id: i.id,
        category_id: i.categoryId,
        name: i.name,
        description: i.description,
        price: i.price,
        image_url: i.imageUrl,
        tags: i.tags,
        is_available: i.isAvailable,
        prep_minutes: i.prepMinutes ?? 0,
        sort_order: i.sortOrder,
        created_at: i.createdAt.toISOString(),
      }));

  // Kategori utama = parent_id NULL; sub-kategori dikelompokkan di bawah induk.
  const mains = categories.filter((c) => c.parentId == null);
  return mains.map((main) => ({
    ...toCat(main),
    items: itemsOf(main.id), // item langsung (biasanya kosong)
    subcategories: categories
      .filter((c) => c.parentId === main.id)
      .map((sub) => ({ ...toCat(sub), items: itemsOf(sub.id) })),
  }));
}

/**
 * Bentuk RATA (flat) dari menu tree utk komponen order/picker: tiap entri =
 * SUB-kategori (tempat item), membawa `parent_name` (kategori utama) utk
 * heading 2 tingkat. Urut sesuai kategori utama → sub-kategori.
 */
export function flattenMenuTree(
  tree: MenuCategoryTree[]
): Array<{
  id: string;
  name: string;
  slug: string;
  parent_name: string | null;
  items: MenuItem[];
}> {
  const out: Array<{
    id: string;
    name: string;
    slug: string;
    parent_name: string | null;
    items: MenuItem[];
  }> = [];
  for (const main of tree) {
    for (const sub of main.subcategories) {
      out.push({
        id: sub.id,
        name: sub.name,
        slug: sub.slug,
        parent_name: main.name,
        items: sub.items,
      });
    }
    // Kalau ada item langsung di kategori utama (tanpa sub) — jaga-jaga.
    if (main.items.length > 0) {
      out.push({
        id: main.id,
        name: main.name,
        slug: main.slug,
        parent_name: null,
        items: main.items,
      });
    }
  }
  return out;
}

// ============================================================
// RATINGS
// ============================================================

/**
 * Get ratable members for a session: semua members (joined + left)
 * KECUALI self. Setiap row carry `already_rated` flag.
 *
 * Original Supabase RPC: get_ratable_members(p_session_id) yang pakai
 * `auth.uid()` implisit. Drizzle version harus pass `raterId` eksplisit.
 *
 * Shape sama dengan RPC original:
 * - member_id = session_members.id (untuk action callback)
 * - already_rated dihitung lewat correlated subquery
 *
 * NOTE: signature berubah — callers harus update pass raterId.
 */
export async function getRatableMembers(
  sessionId: string,
  raterId: string
): Promise<RatableMember[]> {
  const rows = await db
    .select({
      member_id: sessionMembers.id,
      profile_id: profiles.id,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
      already_rated: sql<boolean>`EXISTS (
        SELECT 1 FROM ${memberRatings} mr
        WHERE mr.session_id = ${sessionId}
          AND mr.rater_id = ${raterId}
          AND mr.ratee_id = ${profiles.id}
      )`,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        inArray(sessionMembers.status, ["joined", "left"]),
        sql`${sessionMembers.profileId} <> ${raterId}`
      )
    );

  // Yg saling blokir tak bisa saling rating (PRD Friends K6b).
  const blockedIds = await getBlockedIdSet(raterId);
  return blockedIds.size > 0
    ? rows.filter((r) => !blockedIds.has(r.profile_id))
    : rows;
}

/**
 * Aggregate rating for a profile across all sessions.
 *
 * Original RPC: get_user_rating(p_profile_id) — return avg_stars, rating_count,
 * top_tags (top 3 array). Drizzle version replicate same shape.
 */
export async function getUserRating(
  profileId: string
): Promise<UserRatingSummary> {
  const [agg] = await db
    .select({
      avg_stars: sql<number>`COALESCE(ROUND(AVG(${memberRatings.stars})::numeric, 1), 0)`,
      rating_count: sql<number>`COUNT(*)::int`,
      top_tags: sql<string[] | null>`(
        SELECT array_agg(tag ORDER BY cnt DESC)
        FROM (
          SELECT tag, COUNT(*) AS cnt
          FROM ${memberRatings} mr
          CROSS JOIN LATERAL unnest(mr.tags) AS tag
          WHERE mr.ratee_id = ${profileId}
          GROUP BY tag
          ORDER BY cnt DESC
          LIMIT 3
        ) t
      )`,
    })
    .from(memberRatings)
    .where(eq(memberRatings.rateeId, profileId));

  return {
    avg_stars: Number(agg?.avg_stars ?? 0),
    rating_count: agg?.rating_count ?? 0,
    top_tags: agg?.top_tags ?? null,
  };
}

export async function getUserRatingsBatch(
  profileIds: string[]
): Promise<Record<string, UserRatingSummary>> {
  if (profileIds.length === 0) return {};
  const result: Record<string, UserRatingSummary> = {};
  await Promise.all(
    profileIds.map(async (id) => {
      result[id] = await getUserRating(id);
    })
  );
  return result;
}

// ============================================================
// NETWORK (siapa yg lagi di SOHO + profil publik user)
// ============================================================

/**
 * Hobi yg paling banyak dipakai member (non-guest), urut frekuensi. Untuk chip
 * filter di tab "Semua member" /network. Unnest array hobbies lalu hitung.
 */
export async function getPopularHobbies(limit = 12): Promise<string[]> {
  const rows = await db
    .select({
      hobby: sql<string>`hobby`,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(
      sql`(SELECT unnest(${profiles.hobbies}) AS hobby FROM ${profiles} WHERE ${profiles.isGuest} = false) AS h`
    )
    .groupBy(sql`hobby`)
    .orderBy(sql`COUNT(*) DESC`, sql`hobby ASC`)
    .limit(limit);
  return rows.map((r) => r.hobby).filter(Boolean);
}

/**
 * Daftar user yg sedang nongkrong di meja AKTIF (open/locked) di bar. Termasuk
 * host (role host) & member joined. Exclude guest placeholder (walk-in tanpa
 * akun). Untuk halaman /network section "Lagi di SOHO".
 *
 * 'overdue' SENGAJA dikecualikan: itu hutang lewat-waktu, bukan jaminan orang
 * masih fisik di meja (bisa sudah pulang) — konsisten dgn denah yg juga
 * menyembunyikan overdue.
 *
 * Satu user bisa muncul di >1 sesi (jarang) — di-dedupe per profil, ambil
 * sesi pertama (yg join paling awal).
 */
export async function getActiveUsersAtBar(
  barId: string
): Promise<ActiveNetworkUser[]> {
  const rows = await db
    .select({
      profile_id: profiles.id,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
      session_id: tableSessions.id,
      table_label: tables.label,
      visibility: tableSessions.visibility,
      host_id: tableSessions.hostId,
      joined_at: sessionMembers.joinedAt,
    })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        inArray(tableSessions.status, ["open", "locked"]),
        eq(sessionMembers.status, "joined"),
        eq(profiles.isGuest, false),
        // Privacy: user yg sembunyikan lokasi tak muncul di "Lagi di SOHO".
        eq(profiles.hideLocation, false)
      )
    )
    .orderBy(asc(sessionMembers.joinedAt));

  const seen = new Set<string>();
  const out: ActiveNetworkUser[] = [];
  for (const r of rows) {
    if (seen.has(r.profile_id)) continue;
    seen.add(r.profile_id);
    out.push({
      profile_id: r.profile_id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      session_id: r.session_id,
      table_label: r.table_label,
      visibility: r.visibility as ActiveNetworkUser["visibility"],
      is_host: r.host_id === r.profile_id,
    });
  }
  return out;
}

/**
 * Set profile_id yang sedang nongkrong di bar (sesi open/locked, joined).
 * Ringkas — untuk badge "At SOHO now" di feed Discover. Menghormati privasi
 * lokasi (hideLocation) sama seperti getActiveUsersAtBar.
 */
export async function getActiveProfileIdsAtBar(
  barId: string
): Promise<Set<string>> {
  const rows = await db
    .select({ profile_id: sessionMembers.profileId })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, barId),
        inArray(tableSessions.status, ["open", "locked"]),
        eq(sessionMembers.status, "joined"),
        eq(profiles.isGuest, false),
        eq(profiles.hideLocation, false)
      )
    );
  return new Set(rows.map((r) => r.profile_id));
}

/**
 * Set session_id (open/locked) yang viewer ini sedang ikuti (status joined).
 * Untuk Network: sembunyikan tombol "Gabung" pada meja yg viewer sudah di situ.
 */
export async function getMyActiveSessionIds(
  profileId: string
): Promise<string[]> {
  const rows = await db
    .select({ session_id: sessionMembers.sessionId })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .where(
      and(
        eq(sessionMembers.profileId, profileId),
        eq(sessionMembers.status, "joined"),
        inArray(tableSessions.status, ["open", "locked"])
      )
    );
  return rows.map((r) => r.session_id);
}

/** Berapa kali user pernah jadi member meja (joined/left) = jumlah kunjungan. */
async function getVisitCount(profileId: string): Promise<number> {
  const [agg] = await db
    .select({ c: sql<number>`COUNT(DISTINCT ${sessionMembers.sessionId})::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.profileId, profileId),
        inArray(sessionMembers.status, ["joined", "left"])
      )
    );
  return agg?.c ?? 0;
}

/**
 * Detail profil publik user lain (untuk /network/[userId]): profil + rating +
 * jumlah kunjungan + sesi aktif sekarang (kalau lagi nongkrong). Exclude staff
 * via caller (atau biarkan — profil tetap publik). Null kalau user guest/not found.
 */
export async function getPublicProfile(
  userId: string,
  // viewerId = siapa yang melihat. Kalau = userId (pemilik) atau opts.admin,
  // privacy diabaikan (lihat data lengkap). null/lain = terapkan privacy.
  opts?: { viewerId?: string | null; admin?: boolean }
): Promise<PublicProfile | null> {
  const [p] = await db
    .select({
      id: profiles.id,
      display_name: profiles.displayName,
      username: profiles.username,
      avatar_url: profiles.avatarUrl,
      photos: profiles.photos,
      bio: profiles.bio,
      phone: profiles.phone,
      birth_date: profiles.birthDate,
      is_active: profiles.isActive,
      gender: profiles.gender,
      interested_in: profiles.interestedIn,
      social_link: profiles.socialLink,
      area: profiles.area,
      education: profiles.education,
      height_cm: profiles.heightCm,
      religion: profiles.religion,
      hide_history: profiles.hideHistory,
      hide_location: profiles.hideLocation,
      hide_age: profiles.hideAge,
      hide_social: profiles.hideSocial,
      is_private: profiles.isPrivate,
      hobbies: profiles.hobbies,
      prompts: profiles.prompts,
      is_guest: profiles.isGuest,
      membership_level: profiles.membershipLevel,
      membership_expires_at: profiles.membershipExpiresAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));
  if (!p || p.is_guest) return null;

  // Pemilik & admin lihat semua; selain itu terapkan privacy.
  const bypass = opts?.admin === true || opts?.viewerId === p.id;

  // Saling blokir → profil seolah tak ada (PRD Friends K6, mutual 404).
  // Lapisan kedua setelah guard halaman — jaga-jaga pemanggil baru lupa cek.
  if (!bypass && opts?.viewerId) {
    if (await isBlockedEitherWay(opts.viewerId, p.id)) return null;
  }

  // TEMAN membuka akun privat (PRD K5): is_private di-bypass untuk teman,
  // tapi toggle granular (hide_location, hide_age, hide_social, hide_history)
  // TETAP dihormati — itu pilihan eksplisit per-bidang si pemilik.
  const isFriend =
    !bypass && opts?.viewerId
      ? await areFriends(opts.viewerId, p.id)
      : false;

  // Kunci LEVEL membership (PRD Membership M4): level user ini > level
  // efektif viewer & bukan teman → profil terkunci ala private, UI
  // merender CTA upgrade. Viewer anonim diperlakukan sbg basic.
  const targetLevelKey = effectiveLevelKey(
    p.membership_level,
    p.membership_expires_at
  );
  let lockedByLevel = false;
  if (!bypass && !isFriend) {
    const viewerRank = opts?.viewerId
      ? await getEffectiveRankOf(opts.viewerId)
      : MEMBERSHIP_RANK.basic;
    lockedByLevel = MEMBERSHIP_RANK[targetLevelKey] > viewerRank;
  }

  // Akun privat (ala IG): untuk viewer lain, tampilkan HANYA data yg juga ada
  // di kartu list network (foto, nama, umur, area, education, rating, hobbies,
  // at_soho). Sisanya (bio, social, prompts, religion, tinggi, gender,
  // interested_in) di-null-kan → detail merender stub "terkunci" + blur.
  // Hangout history disembunyikan total. Kunci level ikut jalur yang sama.
  const locked = lockedByLevel || (!bypass && !isFriend && p.is_private);
  const hideAge = !bypass && p.hide_age;
  const hideSocial = locked || (!bypass && p.hide_social);
  const hideLocation = !bypass && p.hide_location;
  const hideHistory = locked || (!bypass && p.hide_history);

  const [rating, visit_count, active] = await Promise.all([
    getUserRating(userId),
    getVisitCount(userId),
    db
      .select({
        session_id: tableSessions.id,
        table_label: tables.label,
        visibility: tableSessions.visibility,
      })
      .from(sessionMembers)
      .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .where(
        and(
          eq(sessionMembers.profileId, userId),
          eq(sessionMembers.status, "joined"),
          // open/locked saja — lihat catatan di getActiveUsersAtBar.
          inArray(tableSessions.status, ["open", "locked"])
        )
      )
      .orderBy(asc(sessionMembers.joinedAt))
      .limit(1),
  ]);

  return {
    id: p.id,
    display_name: p.display_name,
    username: p.username,
    avatar_url: p.avatar_url,
    // Data yg dikunci saat akun privat → null (detail render stub terkunci).
    bio: locked ? null : p.bio,
    phone: p.phone,
    birth_date: hideAge ? null : p.birth_date,
    is_active: p.is_active,
    gender: locked ? null : p.gender,
    interested_in: locked ? null : p.interested_in,
    social_link: hideSocial ? null : p.social_link,
    area: hideLocation ? null : p.area,
    education: p.education,
    height_cm: locked ? null : p.height_cm,
    religion: locked ? null : p.religion,
    hide_history: hideHistory,
    is_private: locked,
    hobbies: locked ? [] : p.hobbies,
    photos: p.photos ?? [],
    prompts: locked ? [] : p.prompts ?? [],
    rating,
    visit_count,
    // Saat privat, sembunyikan juga status "sedang di meja".
    active_session:
      locked || hideLocation || !active[0]
        ? null
        : {
            session_id: active[0].session_id,
            table_label: active[0].table_label,
            visibility: active[0].visibility as ActiveNetworkUser["visibility"],
          },
    locked_by_level: lockedByLevel,
    membership_name: await (async () => {
      const [lvl] = await db
        .select({ name: membershipLevels.name })
        .from(membershipLevels)
        .where(eq(membershipLevels.key, targetLevelKey))
        .limit(1);
      return lvl?.name ?? targetLevelKey;
    })(),
  };
}

/**
 * Riwayat meja user: sesi yg sudah SELESAI (closed/cancelled/overdue) di mana
 * user host ATAU member (bukan pending). Untuk profil publik /network/[userId].
 * Urut terbaru, dibatasi `limit`.
 */
export async function getUserTableHistory(
  profileId: string,
  limit = 20
): Promise<UserTableHistoryEntry[]> {
  const rows = await db
    .select({
      session_id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      visibility: tableSessions.visibility,
      status: tableSessions.status,
      started_at: tableSessions.startedAt,
      is_host: sql<boolean>`${tableSessions.hostId} = ${profileId}`,
      // Status keanggotaan user ini di meja tsb (joined/left/kicked). Dipakai
      // utk menandai "sudah keluar" di riwayat. NULL kalau dia host tanpa baris
      // member (jarang, tapi leftJoin bisa null).
      member_status: sessionMembers.status,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .leftJoin(
      sessionMembers,
      and(
        eq(sessionMembers.sessionId, tableSessions.id),
        eq(sessionMembers.profileId, profileId)
      )
    )
    .where(
      and(
        inArray(tableSessions.status, ["closed", "cancelled", "overdue"]),
        or(
          eq(tableSessions.hostId, profileId),
          and(
            eq(sessionMembers.profileId, profileId),
            ne(sessionMembers.status, "pending")
          )
        )
      )
    )
    .orderBy(desc(tableSessions.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    session_id: r.session_id,
    table_label: r.table_label,
    area_name: r.area_name,
    visibility: r.visibility as UserTableHistoryEntry["visibility"],
    status: r.status as UserTableHistoryEntry["status"],
    started_at: r.started_at.toISOString(),
    is_host: r.is_host,
    member_status:
      (r.member_status as UserTableHistoryEntry["member_status"]) ?? null,
  }));
}

/**
 * Review yg DITERIMA user (rateeId) dari rater lain — stars + tags + siapa.
 * Untuk detail customer admin & profil. Urut terbaru.
 */
export async function getReviewsForUser(
  rateeId: string,
  limit = 50
): Promise<UserReviewEntry[]> {
  const rows = await db
    .select({
      id: memberRatings.id,
      stars: memberRatings.stars,
      tags: memberRatings.tags,
      created_at: memberRatings.createdAt,
      rater_name: profiles.displayName,
      rater_avatar: profiles.avatarUrl,
    })
    .from(memberRatings)
    .innerJoin(profiles, eq(profiles.id, memberRatings.raterId))
    .where(eq(memberRatings.rateeId, rateeId))
    .orderBy(desc(memberRatings.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    stars: r.stars,
    tags: r.tags,
    created_at: r.created_at.toISOString(),
    rater_name: r.rater_name,
    rater_avatar: r.rater_avatar,
  }));
}
