"use server";

/**
 * Server Actions — semua mutations untuk session/order/rating/profile.
 *
 * Migrated dari Supabase client ke Drizzle ORM (Phase 4).
 *
 * Authentication: pakai `requireProfile` dari `@/lib/auth-v2/current`
 * (Auth.js v5 + Drizzle profile lookup).
 *
 * Auth actions (signIn/signUp/signOut/magicLink) HILANG dari file ini —
 * sudah pindah ke `@/lib/auth-v2/actions.ts`. UI components yang import
 * dari sini harus diupdate ke auth-v2 path. Reset password & update
 * password DI-DROP sementara (Phase 5 putuskan apakah perlu di-port).
 *
 * Anonymous sign-in DI-DROP (Phase 2 decision).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne, notInArray, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { menuItems } from "@/lib/db/schema/menu";
import { orders, orderItems, payments, paymentItems } from "@/lib/db/schema/orders";
import { memberRatings, staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { requireProfile } from "@/lib/auth-v2/current";
import { isSessionHost, assertHostOrActiveStaff } from "@/lib/auth-v2/session-auth";
import {
  formatIDR,
  isDbConstraintError,
  normalizeUsername,
} from "@/lib/utils";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import {
  createNotification,
  markInviteResponded,
  markInviteCancelled,
} from "@/lib/notifications";
import {
  settleOverdueIfPaid,
  getOutstandingMap,
  getOrderOutstanding,
  settleOrderIfPaid,
  DP_TIMEOUT_SECONDS,
  PAY_AT_CASHIER_TIMEOUT_SECONDS,
} from "@/lib/queries";
import { notifyPaymentEvent } from "@/lib/payment-notify";
import {
  areFriends,
  isBlockedEitherWay,
  getBlockedIdSet,
  getFriendIdSet,
} from "@/lib/friends";
import {
  getEffectiveRankMap,
  getEffectiveRankOf,
  MEMBERSHIP_RANK,
} from "@/lib/membership";
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
import { sendEmail } from "@/lib/auth-v2/email-service";
import { tableInviteEmail } from "@/lib/auth-v2/email-template";
import { getPaymentGateway } from "@/lib/payments/gateway";
import type { PaymentStatus, PaymentMethod, SplitMode } from "@/types/db";
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  calculateDP,
  computeBillTotals,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";
import { getChargeConfig } from "@/lib/settings-actions";
import {
  validateReservationRange,
  type BookedRange,
} from "@/lib/reservation-helpers";

// ============================================================
// SCHEMAS
// ============================================================

const openTableSchema = z.object({
  tableId: z.string().uuid(),
  title: z.string().min(1).max(80).optional(),
  visibility: z.enum(["public", "friends", "invite_only"]),
  vibeTags: z.array(z.string()).max(5).optional(),
  maxGuests: z.number().int().positive().optional(),
  /**
   * Waktu reservasi (ISO string). Optional:
   * - Omit / null = walk-in immediate (status='open')
   * - Set + waktu < 1 menit dari sekarang = walk-in (status='open')
   * - Set + waktu di masa depan = reservation (status='reserved')
   */
  reservationAt: z.string().datetime().nullable().optional(),
  /**
   * Waktu selesai reservasi (ISO string). Wajib kalau reservationAt di masa
   * depan (booking range). Null/omit untuk walk-in.
   */
  reservationEndAt: z.string().datetime().nullable().optional(),
  /**
   * Order initial. Wajib kalau ada min_spend di meja atau reservation_at di
   * masa depan + minDownPaymentPercent > 0. Minimal 1 item.
   */
  initialOrder: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().positive().max(20),
        notes: z.string().max(200).optional(),
      })
    )
    .max(50)
    .optional(),
  /**
   * Payment method untuk DP. Wajib kalau perlu DP. "mock" untuk dev.
   */
  /** Kode voucher benefit membership utk potongan DP (PRD Membership rev-3). */
  voucherCode: z.string().trim().max(20).optional(),
  dpMethod: z
    .enum(["qris", "cash", "card", "gopay", "ovo", "mock"])
    .optional(),
  /**
   * User yg diajak/diundang (profile id). Untuk visibility:
   * - "public" / "friends": teman langsung di-join (status joined)
   * - "invite_only": diundang (status pending + invited_by = host)
   */
  invitedUserIds: z.array(z.string().uuid()).max(20).optional(),
});

const addOrderItemSchema = z.object({
  sessionId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  quantity: z.number().int().positive().max(20),
  notes: z.string().max(200).optional(),
  /**
   * Optional: untuk staff input order atas nama member meja.
   * Kalau set, staff harus punya permission assist_order DAN tidak boleh
   * jadi member meja sendiri. Order item akan attributed ke member ini,
   * dengan input_by_staff_id = staff yang call.
   */
  onBehalfOfMemberId: z.string().uuid().optional(),
});

const joinSchema = z.object({
  sessionId: z.string().uuid(),
});

// ============================================================
// REALTIME NOTIFY HELPER
// ============================================================

/**
 * Notify both session channel + staff bar channel (best-effort, parallel).
 * Dipanggil setelah commit perubahan apapun yang affect session view atau
 * staff dashboard (members, orders, items, payments).
 *
 * Failure di-swallow di notify() — tidak block main flow.
 */
async function notifySessionAndStaff(sessionId: string): Promise<void> {
  // Lookup bar_id (kalau session masih ada — closed sessions tetap valid)
  const [row] = await db
    .select({ bar_id: floorAreas.barId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  await Promise.all([
    notify(channels.session(sessionId)),
    row ? notify(channels.staff(row.bar_id)) : Promise.resolve(),
    // Bar channel juga di-notify supaya floor map (/bar/[slug]) auto-update
    // saat session/member/order/payment berubah.
    row ? notify(channels.bar(row.bar_id)) : Promise.resolve(),
  ]);
}

// ============================================================
// SESSION LIFECYCLE
// ============================================================

/**
 * Open table — single flow untuk walk-in immediate ATAU reservation booking.
 *
 * Logic:
 * - reservationAt NULL atau dalam 1 menit dari sekarang → walk-in (status='open')
 * - reservationAt di masa depan → reservation (status='reserved')
 *
 * Validation kalau reservation:
 * - Bar settings reservation.enabled=true
 * - Slot align dengan interval, min lead time, booking window, operating hours
 *
 * Validation order initial:
 * - Kalau meja punya min_spend > 0 → total order ≥ min_spend
 * - Kalau reservasi + minDownPaymentPercent > 0 → wajib minimal 1 item + DP
 * - Untuk walk-in tanpa min_spend → order initial optional
 *
 * DP:
 * - Hitung: total_order × minDownPaymentPercent / 100, round up to 100
 * - Insert payment row dengan status='pending', call gateway, update
 *   status & dp_paid_at di session row
 */
export async function openTable(input: z.infer<typeof openTableSchema>) {
  const profile = await requireProfile();
  const data = openTableSchema.parse(input);

  // 1. Verify table + ambil min_spend + bar settings
  const [tableRow] = await db
    .select({
      id: tables.id,
      label: tables.label,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
      is_active: tables.isActive,
      min_spend: tables.minSpend,
      bar_id: floorAreas.barId,
      bar_name: bars.name,
      opening_hours: bars.openingHours,
      reservation_config: bars.reservationConfig,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tables.id, data.tableId));
  if (!tableRow) throw new Error("Table not found");
  if (!tableRow.is_active) throw new Error("Table is inactive");

  const minSpend = tableRow.min_spend ?? 0;

  // 2. Resolve reservation timestamp + mode (walk-in vs reservation)
  const now = new Date();
  const reservationAt =
    data.reservationAt ? new Date(data.reservationAt) : null;
  const reservationEndAt =
    data.reservationEndAt ? new Date(data.reservationEndAt) : null;
  // Walk-in HANYA kalau tidak ada reservationAt sama sekali. Kalau ada
  // reservationAt (dari form reservasi), SELALU reservasi — termasuk slot
  // yang sedang berjalan (mis. pilih 15:00 saat jam 15:42). Tidak ada lagi
  // threshold yang diam-diam mengubah reservasi jadi walk-in.
  const isWalkIn = !reservationAt;

  // 3. Validate reservation range (mulai + selesai) + cek bentrok
  if (!isWalkIn && reservationAt) {
    // Merge dengan defaults dulu (handle existing bar yang belum set field)
    const opHours = {
      ...DEFAULT_OPERATING_HOURS,
      ...((tableRow.opening_hours as OperatingHours) ?? {}),
    };
    const resConfig = {
      ...DEFAULT_RESERVATION_CONFIG,
      ...((tableRow.reservation_config as Partial<ReservationConfig>) ?? {}),
    };

    if (!resConfig.enabled) {
      throw new Error("Reservations are not enabled for this bar");
    }
    if (!reservationEndAt) {
      throw new Error("Reservation end time is required");
    }

    // Ambil reservasi 'reserved' existing di meja ini untuk cek overlap.
    // Hanya yang belum lewat (end > now) yang relevan.
    // Cek overlap dgn session yg punya rentang waktu: reserved ATAU open/locked
    // hasil promote reservasi (yg masih punya reservation range).
    const existingRows = await db
      .select({
        startAt: tableSessions.reservationAt,
        endAt: tableSessions.reservationEndAt,
      })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tableId, data.tableId),
          // overdue tak ikut — rentangnya di masa lalu (kefilter endAt>now) &
          // bukan okupansi fisik.
          inArray(tableSessions.status, ["reserved", "open", "locked"])
        )
      );
    const existing: BookedRange[] = existingRows
      .filter((r) => r.startAt && r.endAt && r.endAt.getTime() > now.getTime())
      .map((r) => ({
        startMs: r.startAt!.getTime(),
        endMs: r.endAt!.getTime(),
      }));

    const validation = validateReservationRange(
      reservationAt,
      reservationEndAt,
      now,
      resConfig,
      opHours,
      existing
    );
    if (!validation.ok) {
      // Validasi yang DIHARAPKAN (jam operasi, slot lewat, bentrok, dll) —
      // bukan bug. RETURN, bukan throw: di production Next.js menyensor pesan
      // thrown error Server Action jadi digest generik ("digest: 1370...")
      // sehingga user tak tahu alasannya. Nilai return TIDAK disensor, jadi
      // pesan aslinya sampai ke client & bisa ditampilkan di toast.
      return {
        ok: false as const,
        error: validation.reason ?? "Invalid reservation time",
      };
    }
  }

  // 4. Fetch resConfig sekali lagi untuk DP calculation
  const resConfig = {
    ...DEFAULT_RESERVATION_CONFIG,
    ...((tableRow.reservation_config as Partial<ReservationConfig>) ?? {}),
  };

  // 5. Validate initial order items + hitung total
  const initialOrder = data.initialOrder ?? [];
  let totalOrder = 0;
  type ResolvedItem = {
    menuItemId: string;
    quantity: number;
    unitPrice: number;
    notes: string | null;
  };
  const resolvedItems: ResolvedItem[] = [];

  if (initialOrder.length > 0) {
    const menuItemIds = initialOrder.map((i) => i.menuItemId);
    const menuRows = await db
      .select({
        id: menuItems.id,
        price: menuItems.price,
        is_available: menuItems.isAvailable,
        name: menuItems.name,
      })
      .from(menuItems)
      .where(inArray(menuItems.id, menuItemIds));
    const menuMap = new Map(menuRows.map((m) => [m.id, m]));

    for (const item of initialOrder) {
      const menu = menuMap.get(item.menuItemId);
      if (!menu) {
        throw new Error("Menu item not found");
      }
      if (!menu.is_available) {
        throw new Error(`Menu "${menu.name}" is currently unavailable`);
      }
      const subtotal = menu.price * item.quantity;
      totalOrder += subtotal;
      resolvedItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: menu.price,
        notes: item.notes ?? null,
      });
    }
  }

  // 6. Min spend check
  if (minSpend > 0 && totalOrder < minSpend) {
    throw new Error(
      `This table has a minimum spend of Rp ${minSpend.toLocaleString("id-ID")}. Your order is only Rp ${totalOrder.toLocaleString("id-ID")}.`
    );
  }

  // 7. DP requirement: reservation + minDownPaymentPercent > 0.
  //    BASIS DP = GRAND TOTAL (subtotal + tax & service), bukan subtotal mentah.
  //    Dulu dari subtotal → DP 100% TIDAK melunasi tagihan (sisa sebesar tax &
  //    service menggantung). Tax & service kini ikut dibayar di awal.
  const chargeCfg = await getChargeConfig(tableRow.bar_id);
  const billAtOpen = computeBillTotals(totalOrder, chargeCfg);
  const dpRequired =
    !isWalkIn && resConfig.minDownPaymentPercent > 0 && totalOrder > 0;
  const dpAmount = dpRequired
    ? calculateDP(billAtOpen.total, resConfig.minDownPaymentPercent)
    : 0;
  // DP yang menutup SELURUH tagihan (mis. minDownPaymentPercent = 100) = bukan
  // deposit parsial, melainkan PELUNASAN penuh di muka. Ditandai supaya jalur
  // pay-at-cashier tidak menjebaknya di lifecycle "DP menggantung": begitu
  // dikonfirmasi kasir, order langsung lunas & meja aktif.
  const dpIsFullPrepay = dpRequired && dpAmount >= billAtOpen.total;

  if (dpRequired) {
    if (resolvedItems.length === 0) {
      throw new Error("A reservation requires at least 1 order item");
    }
    if (!data.dpMethod) {
      throw new Error("Down payment method is required");
    }
  }

  // 6b. Voucher benefit membership utk DP (PRD Membership rev-3). Divalidasi
  //     DINI — sebelum sesi dibuat, gagal = bersih tanpa sisa. Kepemilikan =
  //     host sendiri (sesi belum ada). Reservasi ke baris payment DP terjadi
  //     setelah tx. Penolakan DIKEMBALIKAN (production menyensor throw).
  let dpVoucher: { voucherId: string; code: string; discount: number } | null =
    null;
  if (data.voucherCode?.trim()) {
    if (!dpRequired) {
      return {
        ok: false as const,
        error:
          "Vouchers apply to payments — use it when paying your table bill instead.",
      };
    }
    const resV = await resolveVoucherForBillPayment({
      code: data.voucherCode,
      amount: dpAmount,
      ownerId: profile.id,
    });
    if (!resV.ok) return { ok: false as const, error: resV.error };
    if (resV.voucher.discount >= dpAmount) {
      return {
        ok: false as const,
        error:
          "This voucher covers more than the deposit — save it for the bill payment instead.",
      };
    }
    dpVoucher = {
      voucherId: resV.voucher.voucherId,
      code: resV.voucher.code,
      discount: resV.voucher.discount,
    };
  }

  // 7b. Resolusi user yg diundang. Kandidat mengikuti VISIBILITY meja:
  // - public / invite_only → siapa saja boleh diundang;
  // - friends              → hanya teman host (sejalan K3).
  // Validasi: bukan host, non-staff, non-guest, dedup. Cek kapasitas.
  type Invitee = { id: string; name: string; email: string };
  let invitees: Invitee[] = [];
  // SEMUA undangan perlu persetujuan yg diundang (keputusan produk 2026-07-14):
  // tak ada lagi auto-join. Siapa pun yg dipilih host masuk sbg pending +
  // invited_by, lalu dia sendiri yg Terima/Tolak (acceptInvite/declineInvite).
  if (data.invitedUserIds && data.invitedUserIds.length > 0) {
    const uniqueIds = Array.from(new Set(data.invitedUserIds)).filter(
      (id) => id !== profile.id
    );
    if (uniqueIds.length > 0) {
      const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);
      const rows = await db
        .select({
          id: profiles.id,
          name: profiles.displayName,
          email: users.email,
        })
        .from(profiles)
        .innerJoin(users, eq(users.id, profiles.id))
        .where(
          and(
            inArray(profiles.id, uniqueIds),
            eq(profiles.isGuest, false),
            sql`${profiles.id} NOT IN (${staffIds})`
          )
        );
      invitees = rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
      // Guard relasi (PRD Friends K2 + K6b), saring SENYAP — picker di UI
      // sudah tak menawarkan mereka; sisa hanya percobaan devtools/data basi:
      // - blokir (arah mana pun) → buang (disguised, PRD 7.3);
      // - meja "friends" → yg bisa diundang HANYA teman (sejalan dgn K3:
      //   hanya teman yg boleh masuk meja itu).
      const hiddenIds = await getBlockedIdSet(profile.id);
      invitees = invitees.filter((u) => !hiddenIds.has(u.id));
      if (data.visibility === "friends" && invitees.length > 0) {
        const friendIds = await getFriendIdSet(profile.id);
        invitees = invitees.filter((u) => friendIds.has(u.id));
      }
      // Kunci LEVEL (PRD Membership M6): target undangan harus level <=
      // level host, KECUALI teman. Dibuang senyap — picker sudah tak
      // menawarkan mereka.
      if (invitees.length > 0) {
        const [hostRank, rankMap, friendIds2] = await Promise.all([
          getEffectiveRankOf(profile.id),
          getEffectiveRankMap(invitees.map((u) => u.id)),
          getFriendIdSet(profile.id),
        ]);
        invitees = invitees.filter(
          (u) =>
            friendIds2.has(u.id) ||
            (rankMap.get(u.id) ?? MEMBERSHIP_RANK.basic) <= hostRank
        );
      }
      // Undangan pending sudah "memesan" kursi → cek kapasitas (host + undangan).
      // Dilewati kalau meja izinkan over-capacity (setting admin).
      if (!tableRow.allow_over_capacity) {
        const cap = data.maxGuests ?? tableRow.capacity;
        if (1 + invitees.length > cap) {
          throw new Error(
            `Exceeds table capacity (${cap}). Invite fewer people.`
          );
        }
      }
    }
  }

  // 8. Transaction: create session + members + order + items + invite + DP
  let sessionId: string;
  let dpPaymentId: string | null = null;
  let firstOrderId: string | null = null;
  let dpStatus: "paid" | "pending" = "pending";
  try {
    const result = await db.transaction(async (tx) => {
      const [newSession] = await tx
        .insert(tableSessions)
        .values({
          tableId: data.tableId,
          hostId: profile.id,
          status: isWalkIn ? "open" : "reserved",
          visibility: data.visibility,
          title: data.title ?? null,
          vibeTags: data.vibeTags ?? [],
          maxGuests: data.maxGuests ?? tableRow.capacity,
          reservationAt: isWalkIn ? null : reservationAt,
          reservationEndAt: isWalkIn ? null : reservationEndAt,
        })
        .returning({ id: tableSessions.id });

      await tx.insert(sessionMembers).values({
        sessionId: newSession.id,
        profileId: profile.id,
        role: "host",
        status: "joined",
      });

      // Order pertama (multi-order model): kalau wajib bayar dulu (DP) → order
      // 'unpaid' + item 'draft' (masuk dapur setelah DP lunas, Q7). Kalau tak
      // wajib → langsung 'paid' + item 'sent' (bayar di akhir, Q3).
      const firstOrderPaid = !dpRequired;
      const firstItemStatus: "sent" | "draft" = firstOrderPaid ? "sent" : "draft";
      const [newOrder] = await tx
        .insert(orders)
        .values({
          sessionId: newSession.id,
          status: firstOrderPaid ? "paid" : "unpaid",
          paidAt: firstOrderPaid ? new Date() : null,
        })
        .returning({ id: orders.id });

      // Find host member id untuk attribute order items
      const [hostMember] = await tx
        .select({ id: sessionMembers.id })
        .from(sessionMembers)
        .where(
          and(
            eq(sessionMembers.sessionId, newSession.id),
            eq(sessionMembers.profileId, profile.id)
          )
        );

      if (resolvedItems.length > 0 && hostMember) {
        await tx.insert(orderItems).values(
          resolvedItems.map((it) => ({
            orderId: newOrder.id,
            menuItemId: it.menuItemId,
            addedByMemberId: hostMember.id,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            notes: it.notes,
            status: firstItemStatus,
          }))
        );
      }

      // Undangan: SELALU pending + invited_by — yg diundang yg menyetujui.
      if (invitees.length > 0) {
        await tx.insert(sessionMembers).values(
          invitees.map((u) => ({
            sessionId: newSession.id,
            profileId: u.id,
            role: "member" as const,
            status: "pending" as const,
            invitedBy: profile.id,
          }))
        );
      }

      // DP payment (kalau perlu) — insert pending dulu, gateway call di luar tx
      if (dpRequired && hostMember) {
        const [newPayment] = await tx
          .insert(payments)
          .values({
            orderId: newOrder.id,
            paidByMemberId: hostMember.id,
            amount: dpAmount,
            method: data.dpMethod!,
            status: "pending",
            splitMode: "custom",
            splitMeta: { isDownPayment: true },
            paidAt: null,
          })
          .returning({ id: payments.id });
        return { sessionId: newSession.id, dpPaymentId: newPayment.id, orderId: newOrder.id };
      }

      return { sessionId: newSession.id, dpPaymentId: null, orderId: newOrder.id };
    });
    sessionId = result.sessionId;
    dpPaymentId = result.dpPaymentId;
    firstOrderId = result.orderId;
  } catch (err) {
    if (isDbConstraintError(err, "uq_active_session_per_table")) {
      throw new Error("This table already has an active session/reservation");
    }
    // Race condition: orang lain membooking slot waktu yg sama lebih dulu.
    if (isDbConstraintError(err, "no_overlapping_reservation")) {
      throw new Error(
        "Sorry, this table's time slot was just booked by someone else. Pick another time or table."
      );
    }
    const message = err instanceof Error ? err.message : "";
    throw new Error(message || "Failed to open table");
  }

  // 9. Call gateway untuk DP (kalau ada). Best-effort: kalau gagal, session
  // tetap created tapi DP pending — staff bisa konfirmasi manual nanti.
  // Untuk QRIS (Duitku), simpan qrString supaya client bisa tampilkan QR.
  let dpQris: { paymentId: string; qrString: string } | null = null;
  let dpAwaitCashier = false;
  if (dpPaymentId && dpAmount > 0) {
    // Reservasi voucher ke payment DP (race-safe). Kalah race (nyaris
    // mustahil — divalidasi milidetik lalu) → lanjut TANPA diskon; sesi
    // sudah berdiri, jangan digagalkan.
    let dpDiscount = 0;
    if (dpVoucher) {
      const reserved = await reserveVoucherForPayment(
        dpVoucher.voucherId,
        dpPaymentId,
        dpVoucher.discount
      );
      if (reserved) dpDiscount = dpVoucher.discount;
      else console.error("[openTable] voucher kalah race — DP tanpa diskon");
    }
    const dpCharge = dpAmount - dpDiscount;

    // "Pay at cashier" (method cash): TANPA gateway — DP tetap 'pending',
    // booking menunggu konfirmasi kasir maks 10 menit
    // (PAY_AT_CASHIER_TIMEOUT_SECONDS). Lewat itu → expireDpIfOverdue
    // membatalkan booking & slot mejanya bebas lagi.
    if (data.dpMethod === "cash") {
      await db
        .update(payments)
        .set({
          externalRef: `cashier_${dpPaymentId}`,
          amount: dpCharge,
          splitMeta: {
            isDownPayment: true,
            // Tandai pelunasan penuh: cancelPayment & guard redirect
            // memperlakukannya sbg tagihan biasa, bukan deposit menggantung.
            ...(dpIsFullPrepay ? { dpFull: true } : {}),
            ...(dpDiscount > 0 && dpVoucher
              ? { voucherCode: dpVoucher.code, voucherDiscount: dpDiscount }
              : {}),
            payAtCashier: true,
            expiresAt: new Date(
              Date.now() + PAY_AT_CASHIER_TIMEOUT_SECONDS * 1000
            ).toISOString(),
          },
        })
        .where(eq(payments.id, dpPaymentId));
      dpAwaitCashier = true;
    } else {
    try {
      const gateway = getPaymentGateway();
      const chargeResult = await gateway.createCharge({
        paymentId: dpPaymentId,
        amount: dpCharge,
        method: data.dpMethod!,
        payerName: profile.displayName,
        description: `Table reservation deposit ${tableRow.id.slice(0, 8)}`,
      });
      await db
        .update(payments)
        .set({
          externalRef: chargeResult.externalRef,
          status: chargeResult.status,
          paidAt: chargeResult.status === "paid" ? new Date() : null,
          amount: dpCharge,
          splitMeta: {
            isDownPayment: true,
            ...(dpDiscount > 0 && dpVoucher
              ? { voucherCode: dpVoucher.code, voucherDiscount: dpDiscount }
              : {}),
            qrString: chargeResult.qrString ?? null,
            redirectUrl: chargeResult.redirectUrl ?? null,
            // DP punya batas 1 menit (DP_TIMEOUT_SECONDS), lebih ketat dari
            // masa berlaku QR gateway → pakai ini utk countdown konsisten.
            expiresAt: new Date(
              Date.now() + DP_TIMEOUT_SECONDS * 1000
            ).toISOString(),
            merchantOrderId: chargeResult.merchantOrderId ?? dpPaymentId,
          },
        })
        .where(eq(payments.id, dpPaymentId));
      dpStatus = chargeResult.status === "paid" ? "paid" : "pending";

      // Kalau DP paid, set dp_paid_at di session + order pertama MASUK (Q7:
      // DP lunas cukup utk order pertama masuk dapur).
      if (chargeResult.status === "paid") {
        // Voucher → cetak baris diskon dulu supaya settle melihat DP penuh.
        await settleVoucherForPayment(dpPaymentId);
        await settleRevenueSplitForPayment(dpPaymentId).catch((e) =>
          console.error("[split] openTable DP:", e)
        );
        await db
          .update(tableSessions)
          .set({ dpPaidAt: new Date() })
          .where(eq(tableSessions.id, sessionId));
        if (firstOrderId) await settleOrderIfPaid(firstOrderId);
      } else if (chargeResult.qrString) {
        // DP QRIS menunggu bayar → client tampilkan QR (jangan redirect).
        dpQris = { paymentId: dpPaymentId, qrString: chargeResult.qrString };
      }
    } catch (err) {
      console.error("[openTable] DP gateway charge failed:", err);
      // Lepas reservasi voucher — DP akan ditangani manual tanpa diskon ini.
      await releaseVoucherForPayment(dpPaymentId).catch(() => {});
      // Don't throw — session tetap exist, staff bisa handle manual
    }
    }
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath("/bar/[slug]", "page");

  // 10. Notif in-app + email ke user yg diundang (best-effort).
  if (invitees.length > 0) {
    const link = `/session/${sessionId}`;
    const tableLabel = tableRow.label ?? "table";
    await Promise.allSettled(
      invitees.map(async (u) => {
        await createNotification({
          profileId: u.id,
          type: "table_invite",
          title: `${profile.displayName} invited you to table ${tableLabel}`,
          body: `Open to accept the invite to table ${tableLabel}.`,
          link,
        });
        const tpl = tableInviteEmail({
          email: u.email,
          inviterName: profile.displayName,
          tableLabel,
          barName: tableRow.bar_name ?? "SOHO",
          link,
          mode: "invited",
        });
        await sendEmail({
          to: u.email,
          subject: `Invite to table ${tableLabel}`,
          html: tpl.html,
          text: tpl.text,
        });
      })
    );
  }

  void dpStatus; // unused warning suppress

  // DP "Pay at cashier" → arahkan ke halaman tunggu (/booking/[id]/pay):
  // instruksi konfirmasi ke kasir + countdown 10 menit.
  if (dpAwaitCashier) {
    return { ok: true as const, sessionId, awaitCashier: true as const };
  }

  // DP QRIS menunggu bayar → JANGAN redirect; kembalikan qrString supaya
  // client tampilkan QR + polling. Setelah lunas, client redirect sendiri.
  if (dpQris) {
    return {
      ok: true as const,
      sessionId,
      dpQris,
    };
  }

  // Walk-in / tanpa DP / DP sudah paid → langsung ke session view.
  redirect(`/session/${sessionId}`);
}

// ============================================================
// EDIT INFO MEJA — host / staff ubah deskripsi, visibility, vibe, jam booking
// ============================================================

const updateSessionInfoSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().max(80).nullable().optional(),
  visibility: z.enum(["public", "friends", "invite_only"]).optional(),
  vibeTags: z.array(z.string()).max(5).optional(),
});

/**
 * Edit informasi meja (session). Boleh: HOST meja atau STAFF (kasir/waiter).
 * Field: title (deskripsi), visibility, vibeTags. Jam booking TIDAK diubah di
 * sini (fixed setelah dibuat).
 */
export async function updateSessionInfo(
  input: z.infer<typeof updateSessionInfoSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireProfile();
  const data = updateSessionInfoSchema.parse(input);

  // 1. Ambil session (host + status utk otorisasi).
  const [row] = await db
    .select({
      id: tableSessions.id,
      host_id: tableSessions.hostId,
    })
    .from(tableSessions)
    .where(eq(tableSessions.id, data.sessionId));
  if (!row) throw new Error("Session not found");

  // 2. Otorisasi: host ATAU staff aktif.
  const isHost = row.host_id === profile.id;
  let isStaff = false;
  if (!isHost) {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
      );
    isStaff = !!staff;
  }
  if (!isHost && !isStaff) {
    throw new Error("Only the host or staff can edit this table");
  }

  // 3. Susun perubahan.
  const updates: Partial<{
    title: string | null;
    visibility: "public" | "friends" | "invite_only";
    vibeTags: string[];
  }> = {};
  if (data.title !== undefined) updates.title = data.title?.trim() || null;
  if (data.visibility !== undefined) updates.visibility = data.visibility;
  if (data.vibeTags !== undefined) updates.vibeTags = data.vibeTags;

  if (Object.keys(updates).length === 0) return { ok: true };

  await db
    .update(tableSessions)
    .set(updates)
    .where(eq(tableSessions.id, data.sessionId));

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
  revalidatePath("/bar/[slug]", "page");
  return { ok: true };
}

export async function joinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // 1. Session + table capacity (single join)
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.status !== "open") throw new Error("Session is no longer open");

  // 2. Capacity check — dilewati kalau meja izinkan over-capacity (setting admin).
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (!row.allow_over_capacity && Number(count) >= row.capacity) {
    throw new Error("Table is full");
  }

  // 3. Upsert member (idempotent via unique constraint session_id+profile_id)
  await db
    .insert(sessionMembers)
    .values({
      sessionId,
      profileId: profile.id,
      role: "member",
      status: "joined",
    })
    .onConflictDoUpdate({
      target: [sessionMembers.sessionId, sessionMembers.profileId],
      set: { status: "joined", leftAt: null },
    });

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  return { ok: true, sessionId };
}

/**
 * Request join: insert member dengan status='pending'. Host harus approve dulu.
 * Berbeda dari joinSession (langsung joined) — request join dipakai dari halaman
 * preview tanpa invite code.
 */
export async function requestJoinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // 1. Session check
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      host_id: tableSessions.hostId,
      visibility: tableSessions.visibility,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.status !== "open") throw new Error("Session is no longer open");
  if (row.host_id === profile.id) {
    throw new Error("You're the host — no need to request");
  }

  // Guard relasi (PRD Friends K3 + K6b). Penolakan yg DIHARAPKAN dikembalikan
  // (bukan throw) — production menyensor pesan thrown Server Action.
  // Blokir: pesan generik yg sama dgn friends-only supaya tak membocorkan
  // status blokir (PRD 7.3 disguised).
  if (await isBlockedEitherWay(profile.id, row.host_id)) {
    return {
      status: "error" as const,
      error: "This table isn't accepting join requests right now.",
    };
  }
  if (
    row.visibility === "friends" &&
    !(await areFriends(profile.id, row.host_id))
  ) {
    return {
      status: "error" as const,
      error: "Only the host's friends can join this table.",
    };
  }

  // 2. Capacity check (joined only) — dilewati kalau meja izinkan over-capacity.
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (!row.allow_over_capacity && Number(count) >= row.capacity) {
    throw new Error("Table is full");
  }

  // 3. Existing membership?
  const [existing] = await db
    .select({ id: sessionMembers.id, status: sessionMembers.status })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  if (existing) {
    if (existing.status === "joined") return { status: "joined" as const };
    if (existing.status === "pending") return { status: "pending" as const };
    if (existing.status === "kicked") {
      throw new Error("You were removed from this table by the host");
    }
    // 'left' → revert ke pending
    await db
      .update(sessionMembers)
      .set({ status: "pending", leftAt: null })
      .where(eq(sessionMembers.id, existing.id));
  } else {
    await db.insert(sessionMembers).values({
      sessionId,
      profileId: profile.id,
      role: "member",
      status: "pending",
    });
  }

  // Notif ke host: ada yang minta gabung (perlu approve). Pakai type 'general'
  // (bukan table_invite) — host approve di halaman session, bukan dari tombol
  // Terima/Tolak di bell. Klik notif → buka session.
  await createNotification({
    profileId: row.host_id,
    type: "general",
    title: `${profile.displayName} wants to join table ${row.table_label}`,
    body: "Open the table to approve or decline the request.",
    link: `/session/${sessionId}`,
  });

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath(`/session/${sessionId}/preview`);
  return { status: "pending" as const };
}

export async function approveJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  // Host check + capacity check (single join)
  const [row] = await db
    .select({
      host_id: tableSessions.hostId,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.host_id !== profile.id) {
    throw new Error("Only the host can approve");
  }

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (!row.allow_over_capacity && Number(count) >= row.capacity) {
    throw new Error("Table is full — request can't be approved");
  }

  // Ambil profileId requester (untuk notif) sebelum update.
  const [member] = await db
    .select({ profileId: sessionMembers.profileId })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  // Set pending → joined
  await db
    .update(sessionMembers)
    .set({ status: "joined", joinedAt: new Date() })
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  // Notif ke requester: permintaan gabung diterima.
  if (member) {
    await createNotification({
      profileId: member.profileId,
      type: "table_joined",
      title: `You have been accepted to table ${row.table_label}`,
      body: "The host approved your request. Welcome aboard!",
      link: `/session/${sessionId}`,
    });
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

export async function rejectJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  const [session] = await db
    .select({
      host_id: tableSessions.hostId,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!session) throw new Error("Session not found");
  if (session.host_id !== profile.id) {
    throw new Error("Only the host can reject");
  }

  // Profil requester (untuk notif) sebelum delete.
  const [member] = await db
    .select({ profileId: sessionMembers.profileId })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  // Notif ke requester: permintaan ditolak.
  if (member) {
    await createNotification({
      profileId: member.profileId,
      type: "general",
      title: `Your request to join table ${session.table_label} was declined`,
      body: "The host couldn't accept your request this time.",
      link: null,
    });
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Terima undangan (invite_only): user yg DIUNDANG (member pending dgn
 * invited_by terisi) → jadi joined. Cek kapasitas. Beda dgn approveJoinRequest
 * (itu host yg approve request-join). Di sini USER sendiri yg terima.
 */
export async function acceptInvite(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // Pastikan caller adalah member pending yg DIUNDANG (invited_by not null).
  const [member] = await db
    .select({ id: sessionMembers.id, invitedBy: sessionMembers.invitedBy })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );
  if (!member || member.invitedBy == null) {
    throw new Error("Invite not found or no longer valid");
  }

  // Kapasitas
  const [row] = await db
    .select({ capacity: tables.capacity, host_id: tableSessions.hostId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");

  // Undangan basi dari SEBELUM blokir (PRD K6b): tolak dgn pesan generik yg
  // sama dgn undangan hilang — tak membocorkan status blokir.
  const inviterId = member.invitedBy ?? row.host_id;
  if (await isBlockedEitherWay(profile.id, inviterId)) {
    throw new Error("Invite not found or no longer valid");
  }
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (Number(count) >= row.capacity) {
    throw new Error("Table is full");
  }

  await db
    .update(sessionMembers)
    .set({ status: "joined", joinedAt: new Date() })
    .where(eq(sessionMembers.id, member.id));

  // Notif ke pengundang bahwa undangan diterima. Pengundang = invited_by
  // (fallback host kalau null, mestinya selalu terisi untuk invite).
  await createNotification({
    profileId: member.invitedBy ?? row.host_id,
    type: "invite_accepted",
    title: `${profile.displayName} accepted your invite`,
    body: `${profile.displayName} joined the table.`,
    link: `/session/${sessionId}`,
  });

  // Tandai notif undangan milik penerima sudah direspon → tombol Terima/Tolak
  // di bell hilang, diganti label "Kamu menerima undangan ini".
  await markInviteResponded(`/session/${sessionId}`, "accepted");

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/** Tolak undangan: hapus member pending yg diundang + beri tahu pengundang. */
export async function declineInvite(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // Baca pengundang + label meja SEBELUM delete (row member hilang setelahnya).
  const [info] = await db
    .select({
      invitedBy: sessionMembers.invitedBy,
      hostId: tableSessions.hostId,
      tableLabel: tables.label,
    })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );

  // Notif ke pengundang bahwa undangan ditolak (counterpart invite_accepted).
  if (info) {
    await createNotification({
      profileId: info.invitedBy ?? info.hostId,
      type: "invite_rejected",
      title: `${profile.displayName} declined your invite`,
      body: `${profile.displayName} did not join table ${info.tableLabel}.`,
      link: `/session/${sessionId}`,
    });
  }

  // Tandai notif undangan milik penolak sudah direspon → tombol aksi hilang,
  // diganti label "Kamu menolak undangan ini".
  await markInviteResponded(`/session/${sessionId}`, "rejected");

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

const inviteToSessionSchema = z.object({
  sessionId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1).max(20),
});

/**
 * Host mengundang user ke session yang SUDAH berjalan (dari tab Meja).
 * SELALU pending + invited_by — yg diundang yg menyetujui (acceptInvite);
 * tak ada auto-join (keputusan produk 2026-07-14). Meja "friends" hanya boleh
 * mengundang teman (sejalan K3). Host-only.
 */
export async function inviteUsersToSession(
  input: z.infer<typeof inviteToSessionSchema>
) {
  const profile = await requireProfile();
  const { sessionId, userIds } = inviteToSessionSchema.parse(input);

  // 1. Session + guard host + status open.
  const [row] = await db
    .select({
      status: tableSessions.status,
      host_id: tableSessions.hostId,
      visibility: tableSessions.visibility,
      capacity: tables.capacity,
      allow_over_capacity: tables.allowOverCapacity,
      max_guests: tableSessions.maxGuests,
      table_label: tables.label,
      bar_name: bars.name,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.host_id !== profile.id) {
    throw new Error("Only the host can invite");
  }
  // Invite boleh saat meja OPEN (lagi dipakai) atau RESERVED (booking untuk
  // nanti — host boleh undang teman lebih dulu). Status lain (closed/cancelled/
  // overdue) tak bisa diundang.
  if (row.status !== "open" && row.status !== "reserved") {
    throw new Error(
      "This table isn't open for invites yet — it needs to be reserved or active."
    );
  }

  // 2. Resolusi user: dedup, buang host, non-staff, non-guest. + email.
  const uniqueIds = Array.from(new Set(userIds)).filter(
    (id) => id !== profile.id
  );
  if (uniqueIds.length === 0) throw new Error("No users selected");
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);
  const candidates = await db
    .select({
      id: profiles.id,
      name: profiles.displayName,
      email: users.email,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.id))
    .where(
      and(
        inArray(profiles.id, uniqueIds),
        eq(profiles.isGuest, false),
        sql`${profiles.id} NOT IN (${staffIds})`
      )
    );
  if (candidates.length === 0) throw new Error("Invalid user");

  // 3. Buang yang sudah jadi member (joined / undangan pending), lalu cek
  //    kapasitas. Slot terpakai = joined + undangan yg belum dijawab — undangan
  //    pending sudah "memesan" kursi, jadi tidak boleh over-invite.
  const existing = await db
    .select({
      profileId: sessionMembers.profileId,
      status: sessionMembers.status,
      invitedBy: sessionMembers.invitedBy,
    })
    .from(sessionMembers)
    .where(eq(sessionMembers.sessionId, sessionId));
  const joinedCount = existing.filter((m) => m.status === "joined").length;
  const pendingInviteCount = existing.filter(
    (m) => m.status === "pending" && m.invitedBy != null
  ).length;
  // Sudah aktif/menunggu = jangan dipilih ulang (joined atau pending-invite).
  const occupied = new Set(
    existing
      .filter(
        (m) =>
          m.status === "joined" ||
          (m.status === "pending" && m.invitedBy != null)
      )
      .map((m) => m.profileId)
  );
  let targets = candidates.filter((c) => !occupied.has(c.id));
  if (targets.length === 0) {
    throw new Error("All users are already at the table / invited");
  }
  // Guard relasi (PRD Friends K2 + K6b) — sama dgn openTable: blokir dibuang
  // senyap; meja "friends" hanya boleh mengundang teman.
  const hiddenIds = await getBlockedIdSet(profile.id);
  targets = targets.filter((u) => !hiddenIds.has(u.id));
  if (row.visibility === "friends" && targets.length > 0) {
    const friendIds = await getFriendIdSet(profile.id);
    targets = targets.filter((u) => friendIds.has(u.id));
  }
  // Kunci LEVEL (PRD Membership M6) — sama dgn openTable: level <= host
  // atau teman; sisanya dibuang senyap.
  if (targets.length > 0) {
    const [hostRank, rankMap, friendIds2] = await Promise.all([
      getEffectiveRankOf(profile.id),
      getEffectiveRankMap(targets.map((u) => u.id)),
      getFriendIdSet(profile.id),
    ]);
    targets = targets.filter(
      (u) =>
        friendIds2.has(u.id) ||
        (rankMap.get(u.id) ?? MEMBERSHIP_RANK.basic) <= hostRank
    );
  }
  if (targets.length === 0) throw new Error("No eligible users to invite");
  // Cek kapasitas untuk KEDUA mode: joined + pending-invite + yg baru.
  // Dilewati kalau meja izinkan over-capacity (setting admin).
  const cap = row.max_guests ?? row.capacity;
  if (
    !row.allow_over_capacity &&
    joinedCount + pendingInviteCount + targets.length > cap
  ) {
    throw new Error(
      `Exceeds table capacity (${cap}). Seats & invites are already filled.`
    );
  }

  // 4. Upsert member (handle yg pernah left/kicked/pending via conflict).
  //    SELALU pending + invited_by — yg diundang yg menyetujui.
  for (const u of targets) {
    await db
      .insert(sessionMembers)
      .values({
        sessionId,
        profileId: u.id,
        role: "member",
        status: "pending",
        invitedBy: profile.id,
      })
      .onConflictDoUpdate({
        target: [sessionMembers.sessionId, sessionMembers.profileId],
        set: {
          status: "pending",
          invitedBy: profile.id,
          leftAt: null,
        },
      });
  }

  // 5. Notif in-app + email (best-effort).
  const link = `/session/${sessionId}`;
  const tableLabel = row.table_label ?? "table";
  await Promise.allSettled(
    targets.map(async (u) => {
      await createNotification({
        profileId: u.id,
        type: "table_invite",
        title: `${profile.displayName} invited you to table ${tableLabel}`,
        body: `Open to accept the invite to table ${tableLabel}.`,
        link,
      });
      const tpl = tableInviteEmail({
        email: u.email,
        inviterName: profile.displayName,
        tableLabel,
        barName: row.bar_name ?? "SOHO",
        link,
        mode: "invited",
      });
      await sendEmail({
        to: u.email,
        subject: `Invite to table ${tableLabel}`,
        html: tpl.html,
        text: tpl.text,
      });
    })
  );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  return { invited: targets.length };
}

/**
 * Host membatalkan undangan yang BELUM dijawab (member pending dgn invited_by
 * terisi). Hapus member-nya. Host-only. Beda dgn declineInvite (user sendiri
 * yg menolak) & rejectJoinRequest (host tolak request-join).
 */
export async function cancelInvite(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  // Host check + ambil profil yg diundang + label meja (untuk notif) sebelum
  // delete.
  const [info] = await db
    .select({
      hostId: tableSessions.hostId,
      memberProfileId: sessionMembers.profileId,
      memberStatus: sessionMembers.status,
      invitedBy: sessionMembers.invitedBy,
      tableLabel: tables.label,
    })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId)
      )
    );
  if (!info) throw new Error("Invite not found");
  if (info.hostId !== profile.id) {
    throw new Error("Only the host can cancel an invite");
  }
  if (info.memberStatus !== "pending" || info.invitedBy == null) {
    throw new Error("Only unanswered invites can be cancelled");
  }

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending"),
        sql`${sessionMembers.invitedBy} IS NOT NULL`
      )
    );

  // Beri tahu user yg dibatalkan: notif undangan lamanya jadi "dibatalkan"
  // (tombol Terima/Tolak hilang) + unread lagi.
  await markInviteCancelled(
    info.memberProfileId,
    `/session/${sessionId}`,
    info.tableLabel ?? "table"
  );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Anggota keluar dari meja.
 *
 * GUARD: tak boleh keluar selama MEJA masih punya sisa tagihan (siapa pun yang
 * belum bayar) — cegah orang kabur dari tanggungan bersama. Order 'unpaid'
 * (belum dibayar sama sekali) juga menahan, sama seperti guard di closeSession.
 */
export async function leaveSession(sessionId: string) {
  const profile = await requireProfile();

  // Meja sudah selesai (closed/overdue/cancelled) → tak ada lagi "keluar meja";
  // riwayat keanggotaan dibekukan apa adanya.
  const [sess] = await db
    .select({
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableLabel: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!sess) throw new Error("Table not found");
  if (
    sess.status === "closed" ||
    sess.status === "overdue" ||
    sess.status === "cancelled"
  ) {
    throw new Error("This table has already ended — you can't leave it now.");
  }

  // Sisa tagihan meja (subtotal+charge semua order − pembayaran lunas).
  const outstanding =
    (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
  // Order yang belum dibayar sama sekali (item sudah masuk tapi belum ditagih).
  const [unpaidOrder] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, sessionId), eq(orders.status, "unpaid")));

  if (outstanding > 0 || unpaidOrder) {
    throw new Error(
      "You can't leave while the table still has an unpaid bill. Please settle it first."
    );
  }

  await db
    .update(sessionMembers)
    .set({ status: "left", leftAt: new Date() })
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  // Kabari host + anggota lain yang masih di meja (bukan yang keluar).
  const others = await db
    .select({ profileId: sessionMembers.profileId })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "joined"),
        ne(sessionMembers.profileId, profile.id)
      )
    );
  const recipients = new Set(others.map((o) => o.profileId));
  recipients.add(sess.hostId); // host tetap dikabari walau (mis.) sudah keluar
  recipients.delete(profile.id); // jangan kabari diri sendiri
  await Promise.allSettled(
    Array.from(recipients).map((profileId) =>
      createNotification({
        profileId,
        type: "general",
        title: `${profile.displayName} left table ${sess.tableLabel}`,
        body: "They are no longer at the table.",
        link: `/session/${sessionId}`,
      })
    )
  );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Tutup meja. Boleh dipanggil oleh:
 * - Host meja (customer yang buka meja sendiri)
 * - Staff dengan permission `close_session` (waiter/cashier/manager/admin)
 *
 * Guardrail untuk WAITER: harus lunas. Tujuan: cegah waiter close meja yang
 * belum bayar (resiko kerugian). Cashier/manager/admin tetap bisa close kapan
 * saja (untuk edge case refund / void). Customer host tetap bisa close kapan
 * saja (mereka punya bill sendiri).
 */
export async function closeSession(sessionId: string) {
  const profile = await requireProfile();

  const [session] = await db
    .select({ host_id: tableSessions.hostId })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!session) throw new Error("Session not found");

  const isHost = session.host_id === profile.id;

  // Kalau bukan host, cek apakah dia staff dengan permission close_session
  let staffRoleName: string | null = null;
  if (!isHost) {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
      );
    if (!staff) {
      throw new Error("Only the host or staff can close the table");
    }
    staffRoleName = staff.role;
  }

  // Close guard host/customer (Q6): host TIDAK boleh menutup meja bila masih ada
  // order belum lunas (unpaid) atau sisa tagihan. Staff kasir tetap boleh
  // force-close (meng-void order unpaid). Waiter punya guardrail sendiri di bawah.
  if (isHost) {
    const [unpaidOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.sessionId, sessionId), eq(orders.status, "unpaid")));
    const outstanding =
      (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
    if (unpaidOrder || outstanding > 0) {
      throw new Error(
        "Settle all payments before closing the table."
      );
    }
  }

  // Guardrail waiter: hanya boleh close kalau meja lunas
  if (staffRoleName === "waiter") {
    const [billRow] = await db
      .select({
        subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
      })
      .from(orders)
      .leftJoin(
        orderItems,
        and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
      )
      .where(eq(orders.sessionId, sessionId));

    const [paidRow] = await db
      .select({
        paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        and(eq(orders.sessionId, sessionId), eq(payments.status, "paid"))
      );

    const subtotal = Number(billRow?.subtotal ?? 0);
    const paid = Number(paidRow?.paid ?? 0);
    const outstanding = Math.max(0, subtotal - paid);

    if (outstanding > 0) {
      throw new Error(
        `Not fully paid — Rp ${outstanding.toLocaleString("id-ID")} remaining. Direct the guest to the cashier.`
      );
    }
  }

  // Q6: order 'unpaid' menggantung saat close (staff force-close) → VOID item-nya
  // supaya tak ditagih (order belum "masuk"). Item void tak dihitung outstanding.
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
  }

  // Tentukan outstanding saat tutup. Kalau masih nunggak → status 'overdue'
  // (tagihan tetap tertagih via banner home), JANGAN 'closed' & JANGAN arahkan
  // host ke /rate — itu bikin pingpong /session ⇄ /rate (RatePage tolak krn
  // outstanding>0). Lunas → 'closed' + rating.
  const outstanding = (await getOutstandingMap([sessionId])).get(sessionId) ?? 0;
  const lunas = outstanding <= 0;

  const now = new Date();
  await Promise.all([
    db
      .update(tableSessions)
      .set({ status: lunas ? "closed" : "overdue", closedAt: now })
      .where(eq(tableSessions.id, sessionId)),
    db
      .update(orders)
      .set({ status: "closed", closedAt: now })
      .where(eq(orders.sessionId, sessionId)),
  ]);

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");

  // Customer host: lunas → /rate; belum lunas → tetap di /session (bisa lunasi).
  // Staff → dashboard role-nya supaya bisa lanjut handle meja lain.
  if (isHost) {
    redirect(lunas ? `/session/${sessionId}/rate` : `/session/${sessionId}`);
  }
  if (staffRoleName === "waiter") redirect("/staff/waiter?tab=sessions");
  if (staffRoleName === "cashier") redirect("/staff/cashier");
  redirect("/admin");
}

export async function leaveSessionAndRate(sessionId: string) {
  await leaveSession(sessionId);
  redirect("/");
}

// ============================================================
// ORDER ITEMS
// ============================================================

export async function addOrderItem(input: z.infer<typeof addOrderItemSchema>) {
  const profile = await requireProfile();
  const data = addOrderItemSchema.parse(input);

  // Tentukan member yang nge-attribute order:
  // - Default: current user = member meja (customer flow)
  // - Kalau onBehalfOfMemberId di-set: staff input atas nama member tsb
  let memberId: string;
  let inputByStaffId: string | null = null;

  if (data.onBehalfOfMemberId) {
    // Staff flow: butuh permission assist_order
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
      );
    if (!staff) {
      throw new Error("Only staff can input on behalf of a guest");
    }

    // Verify target member ada di session ini
    const [targetMember] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.id, data.onBehalfOfMemberId),
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!targetMember) {
      throw new Error("Target member not found at this table");
    }

    memberId = targetMember.id;
    inputByStaffId = profile.id;
  } else {
    // Customer flow: HANYA host meja yang boleh menambah pesanan (bukan
    // sekadar member). Sumber kebenaran host = table_sessions.host_id.
    if (!(await isSessionHost(data.sessionId, profile.id))) {
      throw new Error("Only the table host can add orders");
    }
    // Host tetap butuh member row-nya untuk atribusi item (addedByMemberId).
    const [member] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.profileId, profile.id),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!member) throw new Error("You're not a member of this table");
    memberId = member.id;

    // Pay-before-order (jalur customer/host saja — staff dikecualikan, gate ini
    // ada di dalam cabang customer). Kalau masih ada sisa tagihan yang BELUM
    // lunas, host harus melunasinya dulu sebelum menambah pesanan. Hanya
    // pembayaran status 'paid' yang mengurangi outstanding (pending tak
    // membuka gate). (PRD Order Control FR4/FR5.)
    const outstanding =
      (await getOutstandingMap([data.sessionId])).get(data.sessionId) ?? 0;
    if (outstanding > 0) {
      throw new Error(
        `Please settle the outstanding Rp ${outstanding.toLocaleString(
          "id-ID"
        )} before adding more orders`
      );
    }
  }

  // 2. Find open order
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, data.sessionId), ne(orders.status, "closed")));
  if (!order) throw new Error("No open order for this session");

  // 3. Menu item snapshot
  const [item] = await db
    .select({ price: menuItems.price, is_available: menuItems.isAvailable })
    .from(menuItems)
    .where(eq(menuItems.id, data.menuItemId));
  if (!item) throw new Error("Menu item not found");
  if (!item.is_available) throw new Error("Menu item is currently unavailable");

  // 4. Insert
  await db.insert(orderItems).values({
    orderId: order.id,
    menuItemId: data.menuItemId,
    addedByMemberId: memberId,
    inputByStaffId: inputByStaffId,
    quantity: data.quantity,
    unitPrice: item.price,
    notes: data.notes ?? null,
    status: "sent",
  });

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
}

const createOrderSchema = z.object({
  sessionId: z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().positive().max(20),
        notes: z.string().max(200).optional(),
      })
    )
    .min(1)
    .max(50),
  onBehalfOfMemberId: z.string().uuid().optional(),
});

/**
 * Buat ORDER BARU dari cart (multi-order model). Tiap penambahan pesanan = order
 * terpisah berstatus 'unpaid' yang HARUS dibayar dulu baru "masuk" ke dapur/staff.
 *
 * - Auth: host meja (customer) ATAU staff aktif (atas nama meja).
 * - Guard (Q1): maks 1 order 'unpaid' per sesi — kalau masih ada order unpaid
 *   menggantung, tolak (harus lunas dulu).
 * - Item di-insert status 'draft' (belum masuk dapur; jadi 'sent' saat order paid).
 *
 * Return orderId supaya UI bisa arahkan ke halaman detail order utk bayar.
 * (PRD Multi-Order Prepaid FR3/FR5.)
 */
export async function createOrder(
  input: z.infer<typeof createOrderSchema>
): Promise<{ orderId: string }> {
  const profile = await requireProfile();
  const data = createOrderSchema.parse(input);

  // 1. Auth + tentukan member atribusi.
  let memberId: string;
  let inputByStaffId: string | null = null;
  if (data.onBehalfOfMemberId) {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true)));
    if (!staff) throw new Error("Only staff can input on behalf of a guest");
    const [targetMember] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.id, data.onBehalfOfMemberId),
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!targetMember) throw new Error("Target member not found at this table");
    memberId = targetMember.id;
    inputByStaffId = profile.id;
  } else {
    if (!(await isSessionHost(data.sessionId, profile.id))) {
      throw new Error("Only the table host can add orders");
    }
    const [member] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.profileId, profile.id),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!member) throw new Error("You're not a member of this table");
    memberId = member.id;
  }

  // 2. Guard: tak boleh buat order baru kalau masih ada order BELUM LUNAS
  //    (unpaid ATAU order yg masih punya sisa/DP, outstanding > 0). Order closed
  //    diabaikan. (Revisi Q1: "belum lunas" mencakup sisa DP, bukan cuma unpaid.)
  const activeOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.sessionId, data.sessionId),
        notInArray(orders.status, ["closed", "cancelled"])
      )
    );
  for (const o of activeOrders) {
    const { outstanding } = await getOrderOutstanding(o.id);
    if (outstanding > 0) {
      throw new Error("Please settle the previous order before creating a new one");
    }
  }

  // 3. Snapshot harga menu (tolak item tak tersedia).
  const menuIds = [...new Set(data.items.map((i) => i.menuItemId))];
  const menuRows = await db
    .select({ id: menuItems.id, price: menuItems.price, is_available: menuItems.isAvailable })
    .from(menuItems)
    .where(inArray(menuItems.id, menuIds));
  const menuMap = new Map(menuRows.map((m) => [m.id, m]));
  for (const it of data.items) {
    const m = menuMap.get(it.menuItemId);
    if (!m) throw new Error("Menu item not found");
    if (!m.is_available) throw new Error("A selected menu item is currently unavailable");
  }

  // 4. Buat order baru 'unpaid' + item status 'draft' (belum masuk dapur).
  const orderId = await db.transaction(async (tx) => {
    const [newOrder] = await tx
      .insert(orders)
      .values({ sessionId: data.sessionId, status: "unpaid" })
      .returning({ id: orders.id });
    await tx.insert(orderItems).values(
      data.items.map((it) => ({
        orderId: newOrder.id,
        menuItemId: it.menuItemId,
        addedByMemberId: memberId,
        inputByStaffId,
        quantity: it.quantity,
        unitPrice: menuMap.get(it.menuItemId)!.price,
        notes: it.notes ?? null,
        status: "draft" as const,
      }))
    );
    return newOrder.id;
  });

  revalidatePath(`/session/${data.sessionId}`);
  return { orderId };
}

export interface SessionOrderSummary {
  id: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  itemCount: number;
  subtotal: number;
  total: number;
  outstanding: number;
}

/**
 * Daftar order untuk sebuah sesi (multi-order). Tiap order dgn status, jumlah
 * item, total, outstanding. Dipakai tab Bill (list order). Terbaru dulu.
 * (PRD Multi-Order Prepaid FR12.)
 */
export async function getSessionOrders(
  sessionId: string
): Promise<SessionOrderSummary[]> {
  await requireProfile();
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      barId: floorAreas.barId,
      itemCount: sql<number>`COALESCE(SUM(CASE WHEN ${orderItems.status} <> 'void' THEN ${orderItems.quantity} ELSE 0 END), 0)::int`,
      subtotal: sql<number>`COALESCE(SUM(CASE WHEN ${orderItems.status} <> 'void' THEN ${orderItems.quantity} * ${orderItems.unitPrice} ELSE 0 END), 0)::int`,
      paid: sql<number>`0`,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    // Order 'cancelled' (dibatalkan customer) tak ditampilkan di list order.
    .where(
      and(
        eq(orders.sessionId, sessionId),
        ne(orders.status, "cancelled")
      )
    )
    .groupBy(orders.id, floorAreas.barId)
    .orderBy(desc(orders.createdAt));

  // Paid per order.
  const paidRows = await db
    .select({
      orderId: payments.orderId,
      paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(orders.sessionId, sessionId), eq(payments.status, "paid")))
    .groupBy(payments.orderId);
  const paidMap = new Map(paidRows.map((r) => [r.orderId, Number(r.paid)]));

  // Charge config (single-tenant: 1 bar).
  const barId = rows[0]?.barId;
  const charge = barId ? await getChargeConfig(barId) : null;

  return rows.map((r) => {
    const bill = computeBillTotals(Number(r.subtotal), charge);
    const paid = paidMap.get(r.id) ?? 0;
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      itemCount: Number(r.itemCount),
      subtotal: bill.subtotal,
      total: bill.total,
      outstanding: Math.max(0, bill.total - paid),
    };
  });
}

export interface OrderDetail {
  id: string;
  sessionId: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  subtotal: number;
  charge: number;
  chargePercent: number;
  /** Label charge sesuai komponen aktif ("Tax & Service"/"Tax"/"Service charge"). */
  chargeLabel: string;
  total: number;
  paid: number;
  outstanding: number;
  isHost: boolean;
  isStaff: boolean;
  /** Pemanggil kasir (staff role cashier) — utk opsi bayar cash/mark-paid. */
  isCashier: boolean;
  /** Boleh membuat pembayaran utk order ini (host/staff & masih ada sisa). */
  canPay: boolean;
  /** View-only: penonton non-member — nominal/pemesan/pembayaran di-redaksi. */
  viewOnly: boolean;
  /** Anggota joined (id + nama) — utk kasir pilih payer saat terima cash. */
  members: { id: string; name: string }[];
  items: {
    id: string;
    name: string;
    /** Foto menu (null kalau item tak punya gambar). */
    image_url: string | null;
    quantity: number;
    unit_price: number;
    added_by: string | null;
  }[];
  payments: {
    id: string;
    amount: number;
    method: string;
    status: string;
    split_mode: string;
    is_down_payment: boolean;
    /** "Pay at cashier": pending menunggu konfirmasi kasir (tanpa QR). */
    pay_at_cashier: boolean;
    /** Digantikan pembayaran lain yang menutup tagihan (bukan batal biasa). */
    superseded: boolean;
    created_at: string;
    paid_at: string | null;
    paid_by: string;
    paid_by_member_id: string;
    qr_string: string | null;
    expires_at: string | null;
  }[];
  /** Anggota joined (utk split di PaymentSheet). */
  membersCount: number;
  myMemberId: string | null;
}

/**
 * Detail satu ORDER dalam sesi (halaman detail order). Info + item + history
 * payment + izin bayar. qr_string hanya utk pemilik payment/staff.
 * (PRD Multi-Order Prepaid FR14.)
 */
export async function getOrderDetail(
  sessionId: string,
  orderId: string
): Promise<OrderDetail | null> {
  const profile = await requireProfile();

  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      hostId: tableSessions.hostId,
      barId: floorAreas.barId,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(and(eq(orders.id, orderId), eq(orders.sessionId, sessionId)));
  if (!order) return null;

  const isHost = order.hostId === profile.id;
  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profile.id),
        eq(staffRoles.barId, order.barId),
        eq(staffRoles.isActive, true)
      )
    );
  const isStaff = !!staff;
  const isCashier = staff?.role === "cashier";

  const [myMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  const myMemberId = myMember?.id ?? null;

  // Anggota joined (utk kasir pilih payer saat terima cash).
  const memberRows = await db
    .select({ id: sessionMembers.id, name: profiles.displayName })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined")))
    .orderBy(sessionMembers.joinedAt);

  // Items.
  const itemRows = await db
    .select({
      id: orderItems.id,
      name: menuItems.name,
      image_url: menuItems.imageUrl,
      quantity: orderItems.quantity,
      unit_price: orderItems.unitPrice,
      added_by: profiles.displayName,
    })
    .from(orderItems)
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, orderItems.addedByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "void")))
    .orderBy(orderItems.createdAt);

  // Payments (history).
  const payRows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      split_mode: payments.splitMode,
      split_meta: payments.splitMeta,
      created_at: payments.createdAt,
      paid_at: payments.paidAt,
      paid_by_member_id: payments.paidByMemberId,
      paid_by: profiles.displayName,
    })
    .from(payments)
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(eq(payments.orderId, orderId))
    .orderBy(payments.createdAt);

  const charge = await getChargeConfig(order.barId);
  const subtotal = itemRows.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const bill = computeBillTotals(subtotal, charge);
  const paid = payRows
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, bill.total - paid);

  const [{ n: membersCount }] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined")));

  // View-only: user login tapi BUKAN host/staff/member. Boleh lihat item meja
  // (biar tahu pesan apa) TAPI nominal, nama pemesan/pembayar, & data pembayaran
  // DI-REDAKSI di server (privasi sosial: siapa bayar berapa). Order 'cancelled'
  // tak perlu penanganan khusus di sini — memang tampil sbg detail biasa.
  const isViewOnly = !isHost && !isStaff && myMemberId === null;

  // Sisa yang BENAR-BENAR belum tertutup = outstanding − Σ(QRIS pending yg masih
  // hidup). Saat split sudah di-generate & sebagian anggota belum bayar, sisa itu
  // "sudah dipesan" QRIS mereka. Kalau host masih boleh menekan "Pay this order",
  // ia bisa membuat pembayaran yang tumpang-tindih → kalau dua-duanya dibayar,
  // LEBIH BAYAR. Jadi tombol bayar hanya aktif kalau masih ada ruang tak tertutup.
  const nowMs = Date.now();
  const pendingLive = payRows.reduce((sum, p) => {
    if (p.status !== "pending") return sum;
    const m =
      (p.split_meta as { expiresAt?: string | null } | null) ?? {};
    const exp = m.expiresAt ? new Date(m.expiresAt).getTime() : null;
    // Tanpa expiry → anggap masih hidup (konservatif).
    const alive = exp == null || exp > nowMs;
    return alive ? sum + p.amount : sum;
  }, 0);
  const uncovered = Math.max(0, outstanding - pendingLive);

  return {
    id: order.id,
    sessionId,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    subtotal: isViewOnly ? 0 : bill.subtotal,
    charge: isViewOnly ? 0 : bill.charge,
    chargePercent: bill.chargePercent,
    chargeLabel: bill.chargeLabel,
    total: isViewOnly ? 0 : bill.total,
    paid: isViewOnly ? 0 : paid,
    outstanding: isViewOnly ? 0 : outstanding,
    isHost,
    isStaff,
    isCashier,
    // Kasir TETAP boleh menerima pembayaran (mis. tamu bayar tunai di meja kasir
    // walau QRIS-nya masih hidup) — ia punya kontrol & bisa membatalkan QRIS.
    canPay: (isHost || isStaff) && (isCashier ? outstanding > 0 : uncovered > 0),
    viewOnly: isViewOnly,
    members: isViewOnly ? [] : memberRows.map((m) => ({ id: m.id, name: m.name })),
    items: itemRows.map((i) => ({
      id: i.id,
      name: i.name,
      image_url: i.image_url,
      quantity: i.quantity,
      // Nominal & nama pemesan di-redaksi utk view-only.
      unit_price: isViewOnly ? 0 : i.unit_price,
      added_by: isViewOnly ? null : i.added_by,
    })),
    // View-only tak melihat riwayat pembayaran sama sekali.
    payments: isViewOnly
      ? []
      : payRows.map((p) => {
          const meta =
            (p.split_meta as { isDownPayment?: boolean; dpFull?: boolean; payAtCashier?: boolean; supersededByPaid?: boolean; qrString?: string | null; expiresAt?: string | null } | null) ?? {};
          const isMine = p.paid_by_member_id === myMemberId;
          return {
            id: p.id,
            amount: p.amount,
            method: p.method,
            status: p.status,
            split_mode: p.split_mode,
            // DP yang menutup seluruh tagihan bukan "deposit" — tampil sbg bill
            // biasa (badge "Bill"), bukan "DP", supaya tak membingungkan.
            is_down_payment: !!meta.isDownPayment && !meta.dpFull,
            pay_at_cashier: !!meta.payAtCashier,
            superseded: !!meta.supersededByPaid,
            created_at: p.created_at.toISOString(),
            paid_at: p.paid_at ? p.paid_at.toISOString() : null,
            paid_by: p.paid_by,
            paid_by_member_id: p.paid_by_member_id,
            qr_string: isMine || isStaff ? meta.qrString ?? null : null,
            expires_at: meta.expiresAt ?? null,
          };
        }),
    membersCount: Number(membersCount),
    myMemberId,
  };
}

export async function removeOrderItem(itemId: string, sessionId: string) {
  const profile = await requireProfile();

  // Ownership: who added it (via member.profile_id)?
  const [item] = await db
    .select({
      id: orderItems.id,
      added_by_profile_id: sessionMembers.profileId,
    })
    .from(orderItems)
    .innerJoin(
      sessionMembers,
      eq(sessionMembers.id, orderItems.addedByMemberId)
    )
    .where(eq(orderItems.id, itemId));
  if (!item) throw new Error("Item not found");

  const [session] = await db
    .select({ host_id: tableSessions.hostId, bar_id: floorAreas.barId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  // Boleh hapus HANYA staff aktif di bar (kasir/waiter). Customer/host TIDAK
  // boleh batalkan pesanan sendiri — harus lewat kasir/waiter.
  let allowed = false;
  if (session) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, session.bar_id),
          eq(staffRoles.isActive, true)
        )
      );
    allowed = !!staff;
  }
  if (!allowed) {
    throw new Error("Only staff (cashier/waiter) can cancel an order item");
  }

  await db
    .update(orderItems)
    .set({ status: "void" })
    .where(eq(orderItems.id, itemId));

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}


// ============================================================
// PAYMENTS (mock for demo)
// ============================================================

const paySchema = z.object({
  sessionId: z.string().uuid(),
  /** Multi-order: order spesifik yang dibayar. Kalau tak diberi → fallback ke
   *  order aktif sesi (kompat lama). (PRD Multi-Order Prepaid FR17.) */
  orderId: z.string().uuid().optional(),
  amount: z.number().int().positive(),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
  splitMode: z.enum(["equal", "itemized", "custom"]),
  splitMeta: z.record(z.string(), z.unknown()).optional(),
  /** Kode voucher benefit membership (PRD Membership rev-2) — opsional. */
  voucherCode: z.string().trim().max(20).optional(),
});

/**
 * Customer self-pay flow (customer bayar sendiri dari HP setelah pesan).
 *
 * Flow:
 * 1. Verify member ada di session
 * 2. Insert payment dengan status='pending'
 * 3. Call gateway abstraction (getPaymentGateway().createCharge)
 * 4. Update payment dengan external_ref + status dari gateway
 * 5. Return result termasuk qrString (untuk QRIS) atau redirectUrl
 *
 * Sekarang implementasi gateway masih mock (auto-paid). Saat production swap
 * ke Xendit/Midtrans, tidak perlu sentuh function ini — cuma implement adapter
 * baru di lib/payments/gateway.ts.
 */
export async function payShare(input: z.infer<typeof paySchema>): Promise<{
  paymentId: string;
  status: PaymentStatus;
  externalRef: string;
  qrString: string | null;
  redirectUrl: string | null;
  expiresAt: string | null;
}> {
  const profile = await requireProfile();
  const data = paySchema.parse(input);

  // 1. Member + profile lookup (butuh display_name untuk receipt gateway).
  let [member] = await db
    .select({ id: sessionMembers.id, displayName: profiles.displayName })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, data.sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  // Host-only payment: kalau pemanggil adalah member TAPI bukan host meja →
  // tolak. Hanya host (atau staff, cabang di bawah) yang boleh membuat
  // pembayaran/QRIS. (PRD Host-Only Payment FR1/FR2.)
  if (member && !(await isSessionHost(data.sessionId, profile.id))) {
    throw new Error("Only the table host can create payments");
  }

  // Payer bukan member → boleh kalau STAFF aktif di bar sesi (waiter terima
  // pembayaran atas nama meja). Pembayaran diatribusikan ke HOST member.
  if (!member) {
    const [sess] = await db
      .select({ host_id: tableSessions.hostId, bar_id: floorAreas.barId })
      .from(tableSessions)
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
      .where(eq(tableSessions.id, data.sessionId));
    if (!sess) throw new Error("Table not found");

    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, sess.bar_id),
          eq(staffRoles.isActive, true)
        )
      );
    if (!staff) throw new Error("Not a member of this table");

    // Atribusi ke host member meja.
    const [hostMember] = await db
      .select({ id: sessionMembers.id, displayName: profiles.displayName })
      .from(sessionMembers)
      .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
      .where(
        and(
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.profileId, sess.host_id)
        )
      );
    if (!hostMember) throw new Error("Table host not found");
    member = hostMember;
  }

  // 2. Order untuk dibayar. Multi-order: kalau orderId diberi → pakai order itu
  // (dicek milik sesi). Kalau tidak → fallback lama (order non-closed sesi).
  let order: { id: string } | undefined;
  if (data.orderId) {
    const [byId] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, data.orderId), eq(orders.sessionId, data.sessionId)));
    order = byId;
    if (!order) throw new Error("Order not found for this table");
  } else {
    const [openOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.sessionId, data.sessionId), ne(orders.status, "closed")))
      .orderBy(desc(orders.createdAt))
      .limit(1);
    order = openOrder;
    if (!order) {
      const outstanding =
        (await getOutstandingMap([data.sessionId])).get(data.sessionId) ?? 0;
      if (outstanding <= 0) throw new Error("The bill is already paid");
      const [anyOrder] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.sessionId, data.sessionId))
        .orderBy(desc(orders.createdAt))
        .limit(1);
      order = anyOrder;
    }
  }
  if (!order) throw new Error("Order not found");

  // 2c. ANTI LEBIH BAYAR: sisa tagihan yang masih "kosong" = outstanding −
  //     Σ(QRIS pending yang masih hidup). Saat split sudah di-generate & anggota
  //     lain belum bayar, sisa itu sudah dipesan QRIS mereka — membuat pembayaran
  //     baru di atasnya berisiko dibayar dua kali. (DP dikecualikan: alur booking
  //     memang membuat DP lalu pelunasan.)
  const isDpPayment =
    !!(data.splitMeta as { isDownPayment?: boolean } | undefined)?.isDownPayment;
  if (!isDpPayment) {
    const { outstanding: outNow } = await getOrderOutstanding(order.id);
    const livePendings = await db
      .select({ amount: payments.amount, splitMeta: payments.splitMeta })
      .from(payments)
      .where(
        and(eq(payments.orderId, order.id), eq(payments.status, "pending"))
      );
    const nowMs = Date.now();
    const pendingLive = livePendings.reduce((sum, p) => {
      const m = (p.splitMeta as { expiresAt?: string | null } | null) ?? {};
      const exp = m.expiresAt ? new Date(m.expiresAt).getTime() : null;
      const alive = exp == null || exp > nowMs; // tanpa expiry → anggap hidup
      return alive ? sum + p.amount : sum;
    }, 0);
    const uncovered = Math.max(0, outNow - pendingLive);
    if (uncovered <= 0) {
      throw new Error(
        "The remaining bill is already covered by active QRIS payments. Wait for them to be paid or to expire."
      );
    }
    if (data.amount > uncovered) {
      throw new Error(
        `You can pay at most ${formatIDR(uncovered)} right now — the rest is covered by active QRIS payments.`
      );
    }
  }

  // 2d. Voucher benefit membership (PRD Membership rev-2). Divalidasi ULANG
  //     di sini (UI sudah preview via previewBillVoucher) — devtools tak bisa
  //     memaksakan kode orang lain/terpakai. Diskon dicatat sbg baris payments
  //     method='voucher' TERPISAH saat payment utama PAID, jadi outstanding
  //     bill tertutup benar.
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

  // Diskon menutup SELURUH nominal → tak ada yang perlu ditagih: cukup baris
  // voucher (paid) — tanpa gateway, tanpa QR. CHECK amount > 0 di payments
  // melarang baris 0, jadi payment utama tidak dibuat sama sekali.
  if (voucher && chargeAmount <= 0) {
    const [voucherPayment] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        paidByMemberId: member.id,
        amount: voucher.discount,
        method: "voucher",
        status: "paid",
        splitMode: data.splitMode,
        splitMeta: { voucherCode: voucher.code, voucherId: voucher.voucherId },
        paidAt: new Date(),
      })
      .returning({ id: payments.id });
    // Tandai voucher USED menempel ke baris ini (reserve+settle sekali jalan;
    // kalah race → voucher keburu dipakai → batalkan baris tadi).
    const reserved = await reserveVoucherForPayment(
      voucher.voucherId,
      voucherPayment.id,
      voucher.discount
    );
    if (!reserved) {
      await db.delete(payments).where(eq(payments.id, voucherPayment.id));
      throw new Error("This voucher was just used — try another one");
    }
    // Tandai used_at TANPA mencetak baris diskon lagi — baris voucherPayment
    // di atas SUDAH menjadi pembayarannya (skipSyntheticRow).
    await settleVoucherForPayment(voucherPayment.id, { skipSyntheticRow: true });
    await settleOrderIfPaid(order.id);
    await settleOverdueIfPaid(data.sessionId);
    await notifySessionAndStaff(data.sessionId);
    revalidatePath(`/session/${data.sessionId}`);
    revalidatePath("/staff/cashier");
    return {
      paymentId: voucherPayment.id,
      status: "paid" as PaymentStatus,
      externalRef: "",
      qrString: null,
      redirectUrl: null,
      expiresAt: null,
    };
  }

  // 3. Insert payment dengan status='pending'. Nominal = SETELAH potongan
  //    voucher (baris diskon menyusul saat paid).
  const [newPayment] = await db
    .insert(payments)
    .values({
      orderId: order.id,
      paidByMemberId: member.id,
      amount: chargeAmount,
      method: data.method,
      status: "pending",
      splitMode: data.splitMode,
      splitMeta: {
        ...(data.splitMeta ?? {}),
        ...(voucher
          ? { voucherCode: voucher.code, voucherDiscount: voucher.discount }
          : {}),
      },
      paidAt: null,
    })
    .returning({ id: payments.id });

  // Reservasi voucher ke payment ini (race-safe). Kalah race → payment batal.
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
      throw new Error("This voucher was just used — try another one");
    }
  }

  // 3b. Treat (custom, bayar penuh): tautkan SEMUA item order ke payment ini
  // supaya halaman detail transaksi bisa menampilkan seluruh item meja (Q3).
  // itemized ditangani createSplitBatch; equal/DP tidak menulis payment_items.
  if (data.splitMode === "custom") {
    const orderItemsForTreat = await db
      .select({
        id: orderItems.id,
        qty: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
      })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, order.id), ne(orderItems.status, "void")));
    if (orderItemsForTreat.length > 0) {
      await db.insert(paymentItems).values(
        orderItemsForTreat.map((it) => ({
          paymentId: newPayment.id,
          orderItemId: it.id,
          amount: it.qty * it.unitPrice,
        }))
      );
    }
  }

  // 4. Call gateway abstraction. Mock → auto-paid. Real gateway → pending + qrString.
  //    KECUALI "Pay at cashier" (method cash dari customer): TANPA gateway —
  //    payment tetap 'pending' sampai KASIR konfirmasi uang diterima
  //    (cashierMarkPaymentPaid). Selama pending, order tak masuk dapur.
  if (data.method === "cash") {
    await db
      .update(payments)
      .set({
        externalRef: `cashier_${newPayment.id}`,
        splitMeta: {
          ...(data.splitMeta ?? {}),
          ...(voucher
            ? { voucherCode: voucher.code, voucherDiscount: voucher.discount }
            : {}),
          payAtCashier: true,
        },
      })
      .where(eq(payments.id, newPayment.id));

    await notifySessionAndStaff(data.sessionId);
    revalidatePath(`/session/${data.sessionId}`);
    revalidatePath("/staff/cashier");
    revalidatePath(`/staff/cashier/${data.sessionId}`);
    return {
      paymentId: newPayment.id,
      status: "pending" as PaymentStatus,
      externalRef: `cashier_${newPayment.id}`,
      qrString: null,
      redirectUrl: null,
      expiresAt: null,
    };
  }

  const gateway = getPaymentGateway();
  const chargeResult = await gateway.createCharge({
    paymentId: newPayment.id,
    amount: chargeAmount,
    method: data.method,
    payerName: member.displayName,
    description: `Self-pay table - ${data.sessionId.slice(0, 8)}`,
  });

  // 5. Update payment dengan hasil gateway (+ metadata QRIS di split_meta).
  await db
    .update(payments)
    .set({
      externalRef: chargeResult.externalRef,
      status: chargeResult.status,
      paidAt: chargeResult.status === "paid" ? new Date() : null,
      splitMeta: {
        ...(data.splitMeta ?? {}),
        qrString: chargeResult.qrString ?? null,
        redirectUrl: chargeResult.redirectUrl ?? null,
        expiresAt: chargeResult.expiresAt ?? null,
        merchantOrderId: chargeResult.merchantOrderId ?? newPayment.id,
      },
    })
    .where(eq(payments.id, newPayment.id));

  // Kalau sesi 'overdue' (lewat waktu tapi nunggak) dan kini lunas → tutup.
  if (chargeResult.status === "paid") {
    // Voucher → cetak baris diskon DULU supaya settle melihat total penuh.
    await settleVoucherForPayment(newPayment.id);
    // Bagi hasil service fee (best-effort — jangan gagalkan pembayaran).
    await settleRevenueSplitForPayment(newPayment.id).catch((e) =>
      console.error("[split] payShare:", e)
    );
    // Prepaid hook: order 'unpaid' yang kini terbayar → MASUK (paid + item sent).
    await settleOrderIfPaid(order.id);
    await settleOverdueIfPaid(data.sessionId);
  }

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
  // Invalidate staff dashboards juga supaya cashier list & detail auto-update
  // saat customer self-pay
  revalidatePath("/staff/cashier");
  revalidatePath(`/staff/cashier/${data.sessionId}`);

  return {
    paymentId: newPayment.id,
    status: chargeResult.status,
    externalRef: chargeResult.externalRef,
    qrString: chargeResult.qrString ?? null,
    redirectUrl: chargeResult.redirectUrl ?? null,
    expiresAt: chargeResult.expiresAt ?? null,
  };
}

// ============================================================
// SPLIT BATCH — host generate 1 QRIS per anggota (bagi rata dari SISA)
// ============================================================

const splitBatchSchema = z.object({
  sessionId: z.string().uuid(),
  /** Multi-order: order spesifik yang di-split. Fallback ke order aktif sesi. */
  orderId: z.string().uuid().optional(),
  // Hanya 'equal'. Mode 'itemized' DIHAPUS: sejak hanya HOST yang boleh menambah
  // order, semua item ter-atribusi ke host → "item saya" = semua item (host) atau
  // kosong (anggota lain), jadi mode itu tak pernah masuk akal. Nilai "itemized"
  // tetap ada di enum DB utk data historis, tapi tak bisa dibuat lagi.
  mode: z.enum(["equal"]),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
});

export interface SplitBatchMemberResult {
  memberId: string;
  displayName: string;
  paymentId: string | null;
  amount: number;
  status: PaymentStatus | "skipped" | "error";
  qrString: string | null;
  expiresAt: string | null;
  /** Alasan skip/error (mis. sudah punya pending, atau gateway gagal). */
  note?: string;
}

/**
 * Host memicu SATU aksi split → sistem membuat 1 pembayaran + 1 QRIS untuk tiap
 * anggota (mode 'equal'). Tiap anggota nanti hanya melihat QRIS-nya sendiri.
 *
 * - Auth: HOST meja atau staff aktif di bar (jalur staff = sesi walk-in).
 * - equal: share = ceil(REMAINING / N) — dihitung dari SISA, bukan total. Ini
 *   penting saat ada DP: sisa-lah utang bersama yang dibagi. Anggota terakhir
 *   menyerap selisih pembulatan supaya Σ share == remaining (tak over/under).
 * - Anti-duplikat: anggota yang sudah punya payment pending belum-expired dilewati.
 * - Error per-anggota tak menggagalkan semua (best-effort per anggota).
 *
 * (PRD Host-Only Payment FR4-FR8.)
 */
export async function createSplitBatch(
  input: z.infer<typeof splitBatchSchema>
): Promise<{ batchId: string; results: SplitBatchMemberResult[] }> {
  const profile = await requireProfile();
  const data = splitBatchSchema.parse(input);

  // 1. Auth: host atau staff aktif di bar sesi.
  const { barId } = await assertHostOrActiveStaff(data.sessionId, profile.id);

  // 2. Order yang di-split. Multi-order: pakai orderId kalau diberi (dicek milik
  // sesi); else fallback ke order aktif terbaru.
  let order: { id: string } | undefined;
  if (data.orderId) {
    const [byId] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, data.orderId), eq(orders.sessionId, data.sessionId)));
    order = byId;
    if (!order) throw new Error("Order not found for this table");
  } else {
    const [openOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.sessionId, data.sessionId), ne(orders.status, "closed")))
      .orderBy(desc(orders.createdAt))
      .limit(1);
    order = openOrder;
  }
  if (!order) throw new Error("No open order for this session");

  // 3. Bill: subtotal (non-void) + charge → total; remaining = total − paid.
  const [subRow] = await db
    .select({
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), ne(orderItems.status, "void")));
  const charge = await getChargeConfig(barId);
  const bill = computeBillTotals(Number(subRow?.subtotal ?? 0), charge);
  // Remaining PER-ORDER (bukan sesi): total order − Σ(payment lunas order ini).
  const remaining = (await getOrderOutstanding(order.id)).outstanding;
  if (remaining <= 0) throw new Error("This order is already paid");

  // 4. Anggota joined + profil.
  const joined = await db
    .select({
      memberId: sessionMembers.id,
      profileId: sessionMembers.profileId,
      displayName: profiles.displayName,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, data.sessionId),
        eq(sessionMembers.status, "joined")
      )
    );

  // 5. Anggota yang sudah punya payment pending belum-expired → skip (anti-dup).
  const now = Date.now();
  const existing = await db
    .select({
      memberId: payments.paidByMemberId,
      status: payments.status,
      splitMeta: payments.splitMeta,
    })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "pending")));
  const hasActivePending = new Set(
    existing
      .filter((p) => {
        const exp = (p.splitMeta as { expiresAt?: string | null } | null)
          ?.expiresAt;
        return !exp || new Date(exp).getTime() > now;
      })
      .map((p) => p.memberId)
  );

  // 6. Tentukan share per anggota — BAGI RATA DARI SISA (remaining).
  //    Basisnya `remaining`, BUKAN bill.total: kalau sudah ada DP lunas, yang
  //    dibagi adalah sisa utang bersama. (Dulu pakai bill.total → orang pertama
  //    menanggung seluruh sisa & sisanya kebagian 0. Itu bug.)
  //    Contoh: total 100rb, DP 50rb lunas, 2 anggota → masing-masing 25rb.
  type Target = { memberId: string; displayName: string; amount: number; itemIds: { id: string; amount: number }[] };
  const n = joined.length;
  if (n === 0) throw new Error("No members to split between");
  const per = Math.ceil(remaining / n);
  // Anggota terakhir menyerap selisih pembulatan → Σ share == remaining persis.
  let allocated = 0;
  const targets: Target[] = joined.map((m, i) => {
    const isLast = i === n - 1;
    let amount = isLast ? remaining - allocated : Math.min(per, remaining - allocated);
    amount = Math.max(0, amount);
    allocated += amount;
    return { memberId: m.memberId, displayName: m.displayName, amount, itemIds: [] };
  });

  // 7. Buat payment + QRIS per anggota (best-effort per anggota).
  const batchId = crypto.randomUUID();
  const gateway = getPaymentGateway();
  const results: SplitBatchMemberResult[] = [];

  for (const t of targets) {
    if (t.amount <= 0) {
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: 0, status: "skipped", qrString: null, expiresAt: null, note: "Nothing to pay" });
      continue;
    }
    if (hasActivePending.has(t.memberId)) {
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: t.amount, status: "skipped", qrString: null, expiresAt: null, note: "Already has a pending payment" });
      continue;
    }
    try {
      const [pay] = await db
        .insert(payments)
        .values({
          orderId: order.id,
          paidByMemberId: t.memberId,
          amount: t.amount,
          method: data.method,
          status: "pending",
          splitMode: data.mode,
          splitMeta: { batchId },
          paidAt: null,
        })
        .returning({ id: payments.id });

      // Catatan: mode 'equal' tak menulis payment_items (tak ada tautan item).
      // Dulu ada cabang 'itemized' di sini — dihapus bersama mode-nya.

      // "Pay at cashier": tanpa gateway — tiap share pending sampai anggota
      // datang ke kasir & kasir konfirmasi satu-satu.
      if (data.method === "cash") {
        await db
          .update(payments)
          .set({
            externalRef: `cashier_${pay.id}`,
            splitMeta: { batchId, payAtCashier: true },
          })
          .where(eq(payments.id, pay.id));
        results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: pay.id, amount: t.amount, status: "pending", qrString: null, expiresAt: null });
        continue;
      }

      const cr = await gateway.createCharge({
        paymentId: pay.id,
        amount: t.amount,
        method: data.method,
        payerName: t.displayName,
        description: `Split ${data.mode} - ${data.sessionId.slice(0, 8)}`,
      });

      await db
        .update(payments)
        .set({
          externalRef: cr.externalRef,
          status: cr.status,
          paidAt: cr.status === "paid" ? new Date() : null,
          splitMeta: {
            batchId,
            qrString: cr.qrString ?? null,
            redirectUrl: cr.redirectUrl ?? null,
            expiresAt: cr.expiresAt ?? null,
            merchantOrderId: cr.merchantOrderId ?? pay.id,
          },
        })
        .where(eq(payments.id, pay.id));

      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: pay.id, amount: t.amount, status: cr.status, qrString: cr.qrString ?? null, expiresAt: cr.expiresAt ?? null });
    } catch (err) {
      console.error("[createSplitBatch] gagal utk member", t.memberId, err);
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: t.amount, status: "error", qrString: null, expiresAt: null, note: "Gateway error" });
    }
  }

  // Prepaid hook: kalau order kini lunas (semua share paid) → order MASUK.
  await settleOrderIfPaid(order.id);
  // Kalau ada yang langsung paid (mock) & sesi overdue → settle.
  if (results.some((r) => r.status === "paid")) {
    await settleOverdueIfPaid(data.sessionId);
  }

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath(`/staff/cashier/${data.sessionId}`);

  return { batchId, results };
}

/**
 * Generate ULANG QRIS untuk SATU anggota yang pembayarannya gagal/kadaluarsa
 * (mis. telat bayar sampai QR mati). Dipicu host/staff dari tombol di baris
 * riwayat pembayaran anggota tsb.
 *
 * Efek: payment lama ditandai 'failed', dibuat payment BARU dgn nominal SAMA
 * (di-cap ke sisa tagihan) + QRIS baru, lalu notifikasi dikirim HANYA ke anggota
 * itu. Anggota membuka QRIS barunya lewat "Show QR" di riwayat (qr_string sudah
 * di-scope ke pemiliknya).
 *
 * GUARD:
 * - Auth: HOST meja atau staff aktif di bar.
 * - Payment lama harus milik order di sesi ini, dan statusnya 'failed' ATAU
 *   'pending' yang SUDAH lewat expiry. Pending yang MASIH aktif ditolak (cegah
 *   dua QRIS hidup sekaligus → risiko bayar dobel). 'paid' ditolak.
 * - Anti money-loss: sebelum mematikan payment lama, cek gateway — kalau
 *   ternyata sudah lunas, settle & tolak regenerate.
 */
export async function regenerateMemberPayment(input: {
  paymentId: string;
}): Promise<{
  paymentId: string;
  amount: number;
  status: PaymentStatus;
  qrString: string | null;
  expiresAt: string | null;
}> {
  const profile = await requireProfile();

  // 1. Payment lama + konteks (order, sesi, anggota).
  const [old] = await db
    .select({
      id: payments.id,
      status: payments.status,
      amount: payments.amount,
      method: payments.method,
      splitMeta: payments.splitMeta,
      memberId: payments.paidByMemberId,
      orderId: payments.orderId,
      orderStatus: orders.status,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      payerProfileId: sessionMembers.profileId,
      payerName: profiles.displayName,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(eq(payments.id, input.paymentId));
  if (!old) throw new Error("Payment not found");

  // 2. Auth: host meja atau staff aktif di bar sesi (throw kalau bukan).
  await assertHostOrActiveStaff(old.sessionId, profile.id);

  // 3. Order & SESI harus masih hidup. (Sesi cancelled/closed: mejanya bisa
  //    sudah dilepas ke orang lain — jangan sampai terbit QRIS untuk booking
  //    yang tak ada lagi.)
  if (old.orderStatus === "closed" || old.orderStatus === "cancelled") {
    throw new Error("This order is already closed");
  }
  if (old.sessionStatus === "closed" || old.sessionStatus === "cancelled") {
    throw new Error("This table session is already closed");
  }
  if (old.status === "paid") throw new Error("This payment is already paid");

  // 4. DP booking punya lifecycle sendiri (flag isDownPayment → dp_paid_at,
  //    auto-cancel booking saat timeout). Regenerate akan menghilangkan flag itu
  //    & merusak status booking → tolak. DP yang mati harus lewat alur booking.
  const meta =
    (old.splitMeta as {
      expiresAt?: string | null;
      isDownPayment?: boolean;
    } | null) ?? {};
  if (meta.isDownPayment) {
    throw new Error(
      "Down payments can't be re-issued here. Please handle it from the booking."
    );
  }

  // 5. KUNCI ANTI DOUBLE-PAY: QRIS lama TETAP HIDUP di gateway meski kita tandai
  //    'failed' di DB — dan callback Duitku tetap akan menandainya 'paid'. Jadi
  //    kita HANYA boleh menerbitkan QRIS baru kalau GATEWAY SENDIRI memastikan
  //    yang lama sudah mati ('failed' = expired/cancel di Duitku).
  //    'pending' (termasuk saat kita gagal membaca respons gateway) = TOLAK:
  //    lebih baik pengguna menunggu daripada terbit dua QRIS hidup.
  //    Payment yang sudah 'failed' di DB tak perlu ditanya lagi ke gateway.
  const gateway = getPaymentGateway();
  if (old.status !== "failed") {
    let gw: Awaited<ReturnType<typeof gateway.checkStatus>>;
    try {
      gw = await gateway.checkStatus(old.id);
    } catch {
      throw new Error(
        "Couldn't verify the payment status. Please try again in a moment."
      );
    }
    if (gw === "paid") {
      // Ternyata sudah dibayar → settle, jangan buat QRIS baru.
      await db
        .update(payments)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(payments.id, old.id));
      await settleOrderIfPaid(old.orderId);
      await settleOverdueIfPaid(old.sessionId);
      await notifySessionAndStaff(old.sessionId);
      revalidatePath(`/session/${old.sessionId}`);
      throw new Error("That payment was actually paid — no new QRIS needed.");
    }
    if (gw !== "failed") {
      // Masih bisa dibayar di gateway → menerbitkan QRIS kedua = risiko bayar 2×.
      throw new Error(
        "The previous QRIS is still active at the payment provider. Please wait until it expires, then try again."
      );
    }
    // Gateway bilang mati → catat di DB supaya konsisten.
    await db
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(and(eq(payments.id, old.id), ne(payments.status, "paid")));
    await releaseVoucherForPayment(old.id);
  }

  // 6. Nominal: SAMA dgn payment lama, tapi di-cap ke sisa yang BENAR-BENAR
  //    belum tertutup = outstanding − Σ(payment pending yang masih hidup).
  //    Tanpa mengurangi pending, regenerate berulang bisa menerbitkan QRIS
  //    melebihi tagihan (mis. sebagian sudah dibayar tunai ke kasir) → overpay.
  const { outstanding } = await getOrderOutstanding(old.orderId);
  if (outstanding <= 0) throw new Error("This order is already fully paid");

  const pendingRows = await db
    .select({
      amount: payments.amount,
      splitMeta: payments.splitMeta,
      memberId: payments.paidByMemberId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, old.orderId),
        eq(payments.status, "pending"),
        ne(payments.id, old.id)
      )
    );
  const nowMs = Date.now();
  const isAlive = (meta: unknown) => {
    const m = (meta as { expiresAt?: string | null } | null) ?? {};
    const exp = m.expiresAt ? new Date(m.expiresAt).getTime() : null;
    // Tanpa expiry → anggap masih hidup (konservatif).
    return exp == null || exp > nowMs;
  };

  // Anggota ini sudah punya QRIS pengganti yang MASIH HIDUP → jangan terbitkan
  // lagi (kalau tidak, host bisa menumpuk QRIS ketiga, keempat, dst).
  if (
    pendingRows.some((p) => p.memberId === old.memberId && isAlive(p.splitMeta))
  ) {
    throw new Error(
      "A new QRIS was already issued for this member and is still active."
    );
  }

  const pendingLive = pendingRows.reduce(
    (sum, p) => (isAlive(p.splitMeta) ? sum + p.amount : sum),
    0
  );

  const room = Math.max(0, outstanding - pendingLive);
  const amount = Math.min(old.amount, room);
  if (amount <= 0) {
    throw new Error(
      "The remaining bill is already covered by other active payments."
    );
  }

  // 7. Buat payment + QRIS BARU DULU. Payment lama baru dimatikan SETELAH QRIS
  //    baru sukses terbit — kalau gateway gagal, tak ada yang berubah (payment
  //    lama tetap utuh, tak bikin anggota kehilangan riwayat/QRIS-nya).
  // batchId lama DIPERTAHANKAN supaya "cancel split" host tetap bisa mematikan
  // QRIS hasil regenerate ini (kalau dibuang, QRIS baru jadi tak punya
  // kill-switch & bisa terbayar setelah host mengira batch sudah dibatalkan).
  const batchId = (old.splitMeta as { batchId?: string | null } | null)?.batchId;
  const [pay] = await db
    .insert(payments)
    .values({
      orderId: old.orderId,
      paidByMemberId: old.memberId,
      amount,
      method: old.method,
      status: "pending",
      splitMode: "equal",
      splitMeta: { batchId: batchId ?? null, regeneratedFrom: old.id },
      paidAt: null,
    })
    .returning({ id: payments.id });

  let charge: Awaited<ReturnType<typeof gateway.createCharge>>;
  try {
    charge = await gateway.createCharge({
      paymentId: pay.id,
      amount,
      method: old.method,
      payerName: old.payerName,
      description: `Re-issued QRIS - ${old.sessionId.slice(0, 8)}`,
    });
  } catch {
    // Gateway gagal → buang payment kosong biar tak jadi sampah di riwayat.
    // Payment lama SENGAJA tak disentuh (belum sempat di-failed-kan).
    await db.delete(payments).where(eq(payments.id, pay.id));
    throw new Error("Failed to create the QRIS. Please try again.");
  }

  await db
    .update(payments)
    .set({
      externalRef: charge.externalRef,
      status: charge.status,
      paidAt: charge.status === "paid" ? new Date() : null,
      splitMeta: {
        batchId: batchId ?? null,
        regeneratedFrom: old.id,
        qrString: charge.qrString ?? null,
        redirectUrl: charge.redirectUrl ?? null,
        expiresAt: charge.expiresAt ?? null,
        merchantOrderId: charge.merchantOrderId ?? pay.id,
      },
    })
    .where(eq(payments.id, pay.id));

  // NB: payment lama sudah ditandai 'failed' di langkah 5 (setelah gateway
  // memastikan mati). Tak perlu diulang di sini.

  if (charge.status === "paid") {
    await settleOrderIfPaid(old.orderId);
    await settleOverdueIfPaid(old.sessionId);
  }

  // 8. Notifikasi HANYA ke anggota yang bersangkutan (bukan host/staff lain).
  await createNotification({
    profileId: old.payerProfileId,
    type: "general",
    title: "New QRIS ready for you",
    body: `Your previous QRIS expired. A new one for ${formatIDR(amount)} is ready — tap to pay.`,
    link: `/session/${old.sessionId}/order/${old.orderId}`,
  });

  await notifySessionAndStaff(old.sessionId);
  revalidatePath(`/session/${old.sessionId}`);
  revalidatePath(`/session/${old.sessionId}/order/${old.orderId}`);
  revalidatePath("/staff/cashier");

  return {
    paymentId: pay.id,
    amount,
    status: charge.status,
    qrString: charge.qrString ?? null,
    expiresAt: charge.expiresAt ?? null,
  };
}

/**
 * Batalkan seluruh split batch — set semua payment PENDING dalam batch tsb jadi
 * 'failed' (QR mati, tak lagi bisa dibayar). Payment yang sudah 'paid' TIDAK
 * tersentuh. Host-only (atau staff aktif di bar sesi).
 *
 * (PRD Host-Only Payment Q2.)
 */
export async function cancelSplitBatch(input: {
  sessionId: string;
  batchId: string;
}): Promise<{ cancelled: number }> {
  const profile = await requireProfile();
  const sessionId = z.string().uuid().parse(input.sessionId);
  const batchId = z.string().uuid().parse(input.batchId);

  // Auth: host atau staff aktif di bar sesi.
  await assertHostOrActiveStaff(sessionId, profile.id);

  // Batalkan payment pending dalam batch (match split_meta->>'batchId'),
  // dibatasi ke order sesi ini supaya batchId tak bocor lintas sesi.
  const result = await db
    .update(payments)
    .set({ status: "failed" })
    .where(
      and(
        eq(payments.status, "pending"),
        sql`${payments.splitMeta}->>'batchId' = ${batchId}`,
        sql`${payments.orderId} IN (SELECT ${orders.id} FROM ${orders} WHERE ${orders.sessionId} = ${sessionId})`
      )
    )
    .returning({ id: payments.id });

  // Lepas reservasi voucher yang menempel (kalau ada) — aman utk payment
  // tanpa voucher (no-op).
  for (const pRow of result) {
    await releaseVoucherForPayment(pRow.id);
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath(`/staff/cashier/${sessionId}`);

  return { cancelled: result.length };
}

export interface SessionPaymentDetail {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: string;
  splitMode: SplitMode;
  isDownPayment: boolean;
  createdAt: string;
  paidAt: string | null;
  paidByName: string;
  /** Item yang dicakup (hanya itemized). Kosong utk DP/equal/treat. */
  items: { name: string; quantity: number; amount: number }[];
  /** Subtotal item (Σ items.amount). */
  itemsSubtotal: number;
  /** Tax & service atas transaksi ini = amount − itemsSubtotal (≥ 0). */
  taxService: number;
  /** Label charge sesuai komponen aktif. */
  chargeLabel: string;
  /** QR string — HANYA diisi utk pemilik payment atau staff. */
  qrString: string | null;
  expiresAt: string | null;
  /** Bila transaksi bagian dari split batch: ringkasan status tiap anggota
   *  (nama + nominal + status). Kosong utk non-batch. */
  batchMembers: { name: string; amount: number; status: string }[];
}

/**
 * Detail satu transaksi pembayaran dalam sesi (untuk halaman detail transaksi).
 * Menampilkan list item + tax/service + QRIS.
 *
 * Akses: pemilik payment (member) ATAU host meja ATAU staff aktif di bar.
 * qr_string hanya diserahkan ke pemilik atau staff (bukan host lain / anggota lain).
 */
export async function getSessionPaymentDetail(
  sessionId: string,
  paymentId: string
): Promise<SessionPaymentDetail | null> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      splitMode: payments.splitMode,
      splitMeta: payments.splitMeta,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
      payerMemberId: payments.paidByMemberId,
      payerProfileId: sessionMembers.profileId,
      paidByName: profiles.displayName,
      barId: floorAreas.barId,
      hostId: tableSessions.hostId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(and(eq(payments.id, paymentId), eq(orders.sessionId, sessionId)));
  if (!row) return null;

  // Otorisasi + apakah pemanggil boleh lihat QR.
  const isOwner = row.payerProfileId === profile.id;
  const isHost = row.hostId === profile.id;
  let isStaff = false;
  if (!isOwner && !isHost) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, row.barId),
          eq(staffRoles.isActive, true)
        )
      );
    isStaff = !!staff;
  }
  // Harus salah satu: pemilik, host, atau staff (member lain boleh lihat detail
  // transaksi meja — read-only — tapi TANPA QR).
  const [isMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  if (!isOwner && !isHost && !isStaff && !isMember) {
    throw new Error("Not authorized to view this transaction");
  }

  // Item yang dicakup (itemized).
  const its = await db
    .select({
      amount: paymentItems.amount,
      quantity: orderItems.quantity,
      name: menuItems.name,
    })
    .from(paymentItems)
    .innerJoin(orderItems, eq(orderItems.id, paymentItems.orderItemId))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .where(eq(paymentItems.paymentId, paymentId));

  const meta =
    (row.splitMeta as {
      isDownPayment?: boolean;
      qrString?: string | null;
      expiresAt?: string | null;
      batchId?: string | null;
    } | null) ?? {};
  const itemsSubtotal = its.reduce((s, i) => s + i.amount, 0);
  const canSeeQr = isOwner || isStaff;

  // Ringkasan anggota bila transaksi ini bagian dari split batch.
  let batchMembers: { name: string; amount: number; status: string }[] = [];
  if (meta.batchId) {
    batchMembers = await db
      .select({
        name: profiles.displayName,
        amount: payments.amount,
        status: payments.status,
      })
      .from(payments)
      .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
      .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
      .where(sql`${payments.splitMeta}->>'batchId' = ${meta.batchId}`)
      .orderBy(payments.createdAt);
  }

  return {
    id: row.id,
    amount: row.amount,
    method: row.method,
    status: row.status,
    splitMode: row.splitMode,
    isDownPayment: !!meta.isDownPayment,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paidByName: row.paidByName,
    items: its.map((i) => ({ name: i.name, quantity: i.quantity, amount: i.amount })),
    itemsSubtotal,
    // Untuk itemized/treat: tax = amount − subtotal item. Untuk non-item (equal/DP)
    // tak ada rincian item → taxService 0 (amount ditampilkan apa adanya).
    taxService: itemsSubtotal > 0 ? Math.max(0, row.amount - itemsSubtotal) : 0,
    chargeLabel: (await import("@/lib/settings-constants")).computeBillTotals(
      0,
      await getChargeConfig(row.barId)
    ).chargeLabel,
    qrString: canSeeQr ? meta.qrString ?? null : null,
    expiresAt: meta.expiresAt ?? null,
    batchMembers,
  };
}

/**
 * Cek status pembayaran (member/staff sesi) — poll ke gateway (mis. QRIS
 * Duitku). Kalau lunas → tandai paid. Dipakai QR dialog customer/waiter.
 * Akses: pemanggil harus member joined ATAU staff aktif di bar sesi.
 */
export async function checkPaymentStatus(
  paymentId: string
): Promise<{ status: string }> {
  const profile = await requireProfile();

  // Payment + sesi + bar.
  const [row] = await db
    .select({
      id: payments.id,
      status: payments.status,
      splitMeta: payments.splitMeta,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      dpPaidAt: tableSessions.dpPaidAt,
      barId: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(payments.id, paymentId));
  if (!row) throw new Error("Payment not found");
  if (row.status === "paid") return { status: "paid" };

  // Otorisasi: member joined sesi ATAU staff aktif di bar.
  const [asMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, row.sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  let allowed = !!asMember;
  if (!allowed) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, row.barId),
          eq(staffRoles.isActive, true)
        )
      );
    allowed = !!staff;
  }
  if (!allowed) throw new Error("Not allowed");

  const gateway = getPaymentGateway();
  const gwStatus = await gateway.checkStatus(row.id);
  if (gwStatus === "paid") {
    await db
      .update(payments)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(payments.id, row.id));
    // Voucher yang menempel → tandai used + cetak baris diskon (idempotent).
    await settleVoucherForPayment(row.id);
    await settleRevenueSplitForPayment(row.id).catch((e) =>
      console.error("[split] checkPaymentStatus:", e)
    );
    // DP booking lunas → tandai dp_paid_at (booking terkonfirmasi, tak jadi
    // dibatalkan oleh timeout).
    const meta = (row.splitMeta as { isDownPayment?: boolean } | null) ?? {};
    if (meta.isDownPayment) {
      await db
        .update(tableSessions)
        .set({ dpPaidAt: new Date() })
        .where(eq(tableSessions.id, row.sessionId));
    }
    await settleOverdueIfPaid(row.sessionId);
    await notifySessionAndStaff(row.sessionId);
    await notifyPaymentEvent(row.id, meta.isDownPayment ? "dp_confirmed" : "paid");
    revalidatePath(`/session/${row.sessionId}`);
    revalidatePath("/staff/cashier");
    return { status: "paid" };
  }

  // QR kadaluarsa / dibatalkan di Duitku (statusCode "02") → simpan 'failed'
  // supaya UI berhenti menampilkan QR mati (tombol Show QR hilang). Kalau ini
  // DP booking yg masih reserved, batalkan booking-nya juga (meja bebas).
  if (gwStatus === "failed" && row.status !== "failed") {
    await db
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(eq(payments.id, row.id));
    // Lepas reservasi voucher (bisa dipakai lagi).
    await releaseVoucherForPayment(row.id);
    const meta = (row.splitMeta as { isDownPayment?: boolean } | null) ?? {};
    if (
      meta.isDownPayment &&
      row.dpPaidAt == null &&
      (row.sessionStatus === "reserved" || row.sessionStatus === "open")
    ) {
      await db
        .update(tableSessions)
        .set({ status: "cancelled", closedAt: new Date() })
        .where(eq(tableSessions.id, row.sessionId));
      revalidatePath("/bar/[slug]", "page");
    }
    await notifySessionAndStaff(row.sessionId);
    await notifyPaymentEvent(row.id, "cancelled");
    revalidatePath(`/session/${row.sessionId}`);
    revalidatePath("/staff/cashier");
    return { status: "failed" };
  }

  return { status: gwStatus };
}

/**
 * Batalkan payment (dari sisi user/host) — dipakai tombol "Batalkan transaksi"
 * di dialog QRIS, dan saat countdown DP booking habis (00:00).
 * Otorisasi: member joined sesi ATAU staff aktif di bar (sama seperti
 * checkPaymentStatus). Kalau payment ini DP booking yg masih pending →
 * sekalian batalkan booking-nya (session 'cancelled', meja bebas lagi).
 * Idempotent: kalau sudah paid, tidak membatalkan (return paid).
 */
export async function cancelPayment(
  paymentId: string
): Promise<{ status: string; bookingCancelled: boolean }> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: payments.id,
      status: payments.status,
      splitMeta: payments.splitMeta,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      dpPaidAt: tableSessions.dpPaidAt,
      barId: floorAreas.barId,
      barSlug: bars.slug,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(payments.id, paymentId));
  if (!row) throw new Error("Payment not found");
  if (row.status === "paid")
    return { status: "paid", bookingCancelled: false };

  // Otorisasi: member joined sesi ATAU staff aktif di bar.
  const [asMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, row.sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  let allowed = !!asMember;
  if (!allowed) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, row.barId),
          eq(staffRoles.isActive, true)
        )
      );
    allowed = !!staff;
  }
  if (!allowed) throw new Error("Not allowed");

  await db
    .update(payments)
    .set({ status: "failed", paidAt: null })
    .where(eq(payments.id, row.id));
  await releaseVoucherForPayment(row.id);

  // DP booking belum lunas → batalkan booking (meja bebas lagi). Batalkan
  // selama DP belum benar-benar terkonfirmasi (dp_paid_at NULL), baik session
  // masih 'reserved' maupun terlanjur 'open' (mis. ke-promote sebelum fix).
  const meta = (row.splitMeta as { isDownPayment?: boolean } | null) ?? {};
  let bookingCancelled = false;
  if (
    meta.isDownPayment &&
    row.dpPaidAt == null &&
    (row.sessionStatus === "reserved" || row.sessionStatus === "open")
  ) {
    await db
      .update(tableSessions)
      .set({ status: "cancelled", closedAt: new Date() })
      .where(eq(tableSessions.id, row.sessionId));
    bookingCancelled = true;
    revalidatePath("/bar/[slug]", "page");
  }

  await notifySessionAndStaff(row.sessionId);
  await notifyPaymentEvent(row.id, "cancelled");
  revalidatePath(`/session/${row.sessionId}`);
  revalidatePath("/staff/cashier");
  return { status: "cancelled", bookingCancelled };
}

/**
 * Batalkan order yang MASIH UNPAID (belum dibayar) beserta pembayaran pending-nya.
 * Dipakai saat customer klik "kembali" dari halaman pembayaran order baru lalu
 * konfirmasi batal.
 *
 * Efek: order.status = 'cancelled', semua item order → 'void', payment pending
 * (belum paid) → 'failed'. Order 'cancelled' tak muncul di dapur/kasir/tagihan.
 *
 * GUARD: hanya order berstatus 'unpaid' (order paid/closed tak bisa dibatalkan
 * lewat sini). Auth: member joined sesi ATAU staff aktif di bar (pola sama
 * dengan cancelPayment). Idempotent-ish: order yg sudah 'cancelled' → no-op.
 */
export async function cancelUnpaidOrder(
  orderId: string
): Promise<{ status: "cancelled" | "already_paid" }> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      sessionId: orders.sessionId,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!row) throw new Error("Order not found");

  // Order yg sudah lunas/closed tak boleh dibatalkan lewat sini.
  if (row.status === "paid" || row.status === "closed") {
    return { status: "already_paid" };
  }
  if (row.status === "cancelled") {
    return { status: "cancelled" }; // sudah batal → no-op
  }

  // Otorisasi: HANYA host meja atau staff aktif di bar. Order milik MEJA — anggota
  // biasa (yang cuma bayar bagiannya) tak boleh membatalkan order orang sekejap.
  // (Dulu: "member joined ATAU staff" — terlalu longgar.)
  await assertHostOrActiveStaff(row.sessionId, profile.id);

  // ANTI MONEY-LOSS: sebelum membatalkan, cek ke gateway apakah ada pembayaran
  // pending yg SEBENARNYA sudah lunas (dibayar di bank tapi belum ke-refleksi
  // di DB via polling). Kalau ada → JANGAN batalkan; settle order jadi paid.
  const pendingPays = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
  if (pendingPays.length > 0) {
    const gateway = getPaymentGateway();
    for (const p of pendingPays) {
      let gwStatus: Awaited<ReturnType<typeof gateway.checkStatus>>;
      try {
        gwStatus = await gateway.checkStatus(p.id);
      } catch {
        // Gagal cek gateway → jangan ambil risiko membatalkan pembayaran yg
        // mungkin sudah lunas. Tolak cancel; user bisa coba lagi / lanjut bayar.
        throw new Error(
          "Couldn't verify the payment status. Please try again in a moment."
        );
      }
      if (gwStatus === "paid") {
        // Pembayaran ternyata lunas → settle order (jadi paid), batal cancel.
        await db
          .update(payments)
          .set({ status: "paid", paidAt: new Date() })
          .where(eq(payments.id, p.id));
        await settleOrderIfPaid(orderId);
        await notifySessionAndStaff(row.sessionId);
        revalidatePath(`/session/${row.sessionId}`);
        return { status: "already_paid" };
      }
    }
  }

  let cancelledPaymentIds: { id: string }[] = [];
  await db.transaction(async (tx) => {
    // Batalkan pembayaran pending/failed (belum paid) yang menempel di order.
    cancelledPaymentIds = await tx
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(and(eq(payments.orderId, orderId), ne(payments.status, "paid")))
      .returning({ id: payments.id });
    // Void semua item (biar tak terhitung di agregat manapun).
    await tx
      .update(orderItems)
      .set({ status: "void" })
      .where(eq(orderItems.orderId, orderId));
    // Tandai order cancelled.
    await tx
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, orderId));
  });

  // Lepas reservasi voucher pada payment yang ikut dibatalkan (pasca-commit).
  for (const pRow of cancelledPaymentIds) {
    await releaseVoucherForPayment(pRow.id);
  }

  await notifySessionAndStaff(row.sessionId);
  revalidatePath(`/session/${row.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath("/staff/waiter");
  return { status: "cancelled" };
}

// ============================================================
// STAFF / WAITER
// ============================================================

/**
 * Guard untuk Server Actions yang butuh staff role.
 * Throw (bukan redirect) supaya error muncul di toast UI, bukan
 * navigate ke halaman lain.
 */
async function requireStaffAction() {
  const profile = await requireProfile();
  const [staff] = await db
    .select({ role: staffRoles.role, bar_id: staffRoles.barId })
    .from(staffRoles)
    .where(
      and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
    );
  if (!staff) {
    throw new Error("Staff access required");
  }
  return { profile, staff };
}

export async function markOrderItemStatus(
  itemId: string,
  newStatus: "preparing" | "served"
) {
  await requireStaffAction();

  const patch: { status: "preparing" | "served"; servedAt?: Date } = {
    status: newStatus,
  };
  if (newStatus === "served") {
    patch.servedAt = new Date();
  }

  await db.update(orderItems).set(patch).where(eq(orderItems.id, itemId));

  // Lookup sessionId via order → notify session + staff bar
  const [link] = await db
    .select({ session_id: orders.sessionId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.id, itemId));
  if (link) await notifySessionAndStaff(link.session_id);

  revalidatePath("/staff");
}

// ============================================================
// RATINGS (member-to-member after session closed)
// ============================================================

const submitRatingSchema = z.object({
  sessionId: z.string().uuid(),
  rateeId: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(30)).max(5).optional(),
});

export async function submitRating(input: z.infer<typeof submitRatingSchema>) {
  const profile = await requireProfile();
  const data = submitRatingSchema.parse(input);

  if (data.rateeId === profile.id) {
    throw new Error("You can't rate yourself");
  }

  // Blokir (arah mana pun) → no-op SENYAP (PRD K6b tutup semua jalur +
  // 7.3 disguised). UI (getRatableMembers) sudah tak menampilkan orangnya.
  if (await isBlockedEitherWay(profile.id, data.rateeId)) {
    revalidatePath(`/session/${data.sessionId}/rate`);
    return;
  }

  await db
    .insert(memberRatings)
    .values({
      sessionId: data.sessionId,
      raterId: profile.id,
      rateeId: data.rateeId,
      stars: data.stars,
      tags: data.tags ?? [],
    })
    .onConflictDoUpdate({
      target: [memberRatings.sessionId, memberRatings.raterId, memberRatings.rateeId],
      set: { stars: data.stars, tags: data.tags ?? [] },
    });

  revalidatePath(`/session/${data.sessionId}/rate`);
}

// ============================================================
// PROFILE
// ============================================================

const updateProfileSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters").max(40),
  /** Username unik. Kosong = tak diubah (biarkan yg ada). */
  username: z.string().optional().or(z.literal("")),
  phone: z
    .string()
    .max(20)
    .regex(/^[\d\s+\-()]*$/, "Invalid WhatsApp number format")
    .optional()
    .or(z.literal("")),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .optional()
    .or(z.literal("")),
  bio: z.string().max(280, "Max 280 characters").optional().or(z.literal("")),
  gender: z.enum(["male", "female"]).optional().or(z.literal("")),
  interestedIn: z.enum(["male", "female", "both"]).optional().or(z.literal("")),
  socialLink: z.string().max(200).optional().or(z.literal("")),
  area: z.string().max(120).optional().or(z.literal("")),
  lookingFor: z
    .enum(["relationship", "casual", "friendship"])
    .optional()
    .or(z.literal("")),
  education: z
    .enum([
      "high_school",
      "diploma",
      "bachelor",
      "master",
      "doctorate",
      "other",
    ])
    .optional()
    .or(z.literal("")),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  religion: z
    .enum([
      "islam",
      "christian",
      "catholic",
      "hindu",
      "buddhist",
      "confucian",
      "spiritual",
    ])
    .optional()
    .or(z.literal("")),
  musicPref: z.string().max(120).optional().or(z.literal("")),
  favFood: z.string().max(120).optional().or(z.literal("")),
  favDrink: z.string().max(120).optional().or(z.literal("")),
  hideHistory: z.boolean().optional(),
  hideLocation: z.boolean().optional(),
  hideAge: z.boolean().optional(),
  hideSocial: z.boolean().optional(),
  hobbies: z.array(z.string().min(1).max(30)).max(15).optional(),
  prompts: z
    .array(
      z.object({
        prompt: z.string().min(1).max(120),
        answer: z.string().min(1).max(280),
      })
    )
    .max(5)
    .optional(),
});

export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const profile = await requireProfile();
  const data = updateProfileSchema.parse(input);

  // Clean hobbies: trim + dedup, preserve original-case
  const hobbies = (data.hobbies ?? [])
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .filter((h, i, arr) => arr.indexOf(h) === i);

  // Clean prompts: trim + buang kosong, maks 5.
  const prompts = (data.prompts ?? [])
    .map((p) => ({ prompt: p.prompt.trim(), answer: p.answer.trim() }))
    .filter((p) => p.prompt && p.answer)
    .slice(0, 5);

  // Username: kalau dikirim & tak kosong → validasi + cek unik (kecuali milik
  // sendiri). Kosong = tak diubah.
  let usernameUpdate: { username: string } | Record<string, never> = {};
  const rawUsername = data.username?.trim();
  if (rawUsername) {
    const u = normalizeUsername(rawUsername);
    if (!u.ok) throw new Error(u.error);
    const [clash] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.username, u.value), ne(profiles.id, profile.id)));
    if (clash) throw new Error("Username already taken");
    usernameUpdate = { username: u.value };
  }

  await db
    .update(profiles)
    .set({
      displayName: data.displayName,
      ...usernameUpdate,
      phone: data.phone?.trim() || null,
      birthDate: data.birthDate || null,
      bio: data.bio?.trim() || null,
      gender: data.gender || null,
      interestedIn: data.interestedIn || null,
      socialLink: data.socialLink?.trim() || null,
      area: data.area || null,
      lookingFor: data.lookingFor || null,
      education: data.education || null,
      ...(data.heightCm !== undefined ? { heightCm: data.heightCm } : {}),
      religion: data.religion || null,
      musicPref: data.musicPref?.trim() || null,
      favFood: data.favFood?.trim() || null,
      favDrink: data.favDrink?.trim() || null,
      ...(data.hideHistory !== undefined ? { hideHistory: data.hideHistory } : {}),
      ...(data.hideLocation !== undefined ? { hideLocation: data.hideLocation } : {}),
      ...(data.hideAge !== undefined ? { hideAge: data.hideAge } : {}),
      ...(data.hideSocial !== undefined ? { hideSocial: data.hideSocial } : {}),
      hobbies,
      // Hanya tulis prompts kalau caller mengirim (jaga data lama kalau field
      // tak dikirim). Form edit selalu mengirim.
      ...(data.prompts !== undefined ? { prompts } : {}),
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
}

/**
 * Update profil STAFF (kasir/waiter) — minimal: hanya nama tampilan. Field
 * lain (WA, bio, gender, dll) TIDAK disentuh (staff tak punya form itu). Foto
 * ditangani AvatarUploader terpisah.
 */
export async function updateStaffProfile(input: { displayName: string }) {
  const profile = await requireProfile();
  const displayName = z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(40)
    .parse(input.displayName.trim());

  await db
    .update(profiles)
    .set({ displayName })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/staff/profile");
  revalidatePath("/", "layout");
}

/**
 * Set akun privat (ala Instagram) — true = user lain hanya lihat data list
 * network, sisanya diblur+kunci di detail & hangout history disembunyikan.
 */
export async function updatePrivacy(isPrivate: boolean) {
  const profile = await requireProfile();
  await db
    .update(profiles)
    .set({ isPrivate: !!isPrivate })
    .where(eq(profiles.id, profile.id));
  revalidatePath("/profile");
  revalidatePath("/profile/privacy");
  // Detail profil publik ikut berubah gate-nya.
  revalidatePath("/network");
}

// ============================================================
// ONBOARDING (wizard step 2-3 saat daftar)
// ============================================================

const onboardingSchema = z.object({
  // Step 2 — data diri
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  gender: z.enum(["male", "female"]).optional().or(z.literal("")),
  interestedIn: z.enum(["male", "female", "both"]).optional().or(z.literal("")),
  area: z.string().max(120).optional().or(z.literal("")),
  socialLink: z.string().max(200).optional().or(z.literal("")),
  // Step 3 — interest & preferensi
  lookingFor: z
    .enum(["relationship", "casual", "friendship"])
    .optional()
    .or(z.literal("")),
  education: z
    .enum([
      "high_school",
      "diploma",
      "bachelor",
      "master",
      "doctorate",
      "other",
    ])
    .optional()
    .or(z.literal("")),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  religion: z
    .enum([
      "islam",
      "christian",
      "catholic",
      "hindu",
      "buddhist",
      "confucian",
      "spiritual",
    ])
    .optional()
    .or(z.literal("")),
  musicPref: z.string().max(120).optional().or(z.literal("")),
  favFood: z.string().max(120).optional().or(z.literal("")),
  favDrink: z.string().max(120).optional().or(z.literal("")),
  bio: z.string().max(280).optional().or(z.literal("")),
  hobbies: z.array(z.string().min(1).max(30)).max(15).optional(),
  prompts: z
    .array(
      z.object({
        prompt: z.string().min(1).max(120),
        answer: z.string().min(1).max(280),
      })
    )
    .max(5)
    .optional(),
});

/** Selesaikan onboarding: simpan profil step 2-3 + tandai onboarded=true. */
export async function completeOnboarding(
  input: z.infer<typeof onboardingSchema>
) {
  const profile = await requireProfile();
  const data = onboardingSchema.parse(input);

  const hobbies = (data.hobbies ?? [])
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .slice(0, 8); // maks 8 interest (CMB-style "What do you like?")

  await db
    .update(profiles)
    .set({
      birthDate: data.birthDate || null,
      gender: data.gender || null,
      interestedIn: data.interestedIn || null,
      area: data.area || null,
      socialLink: data.socialLink?.trim() || null,
      lookingFor: data.lookingFor || null,
      education: data.education || null,
      heightCm: data.heightCm ?? null,
      religion: data.religion || null,
      musicPref: data.musicPref?.trim() || null,
      favFood: data.favFood?.trim() || null,
      favDrink: data.favDrink?.trim() || null,
      bio: data.bio?.trim() || null,
      hobbies,
      prompts: (data.prompts ?? [])
        .map((p) => ({ prompt: p.prompt.trim(), answer: p.answer.trim() }))
        .filter((p) => p.prompt && p.answer)
        .slice(0, 5),
      onboarded: true,
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/", "layout");
}

// ============================================================
// PASSWORD CHANGE
// ============================================================

const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional(), // optional untuk magic-link users
    newPassword: z.string().min(6, "Password must be at least 6 characters").max(100),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Password confirmation does not match",
    path: ["confirmPassword"],
  });

/**
 * Ubah / set password.
 *
 * - Kalau user sudah punya password (passwordHash != null): WAJIB pass
 *   currentPassword yang harus match.
 * - Kalau user belum punya password (signup via magic link): currentPassword
 *   tidak dipakai, langsung set newPassword.
 *
 * Server-side enforce supaya tidak bisa di-bypass dari client.
 */
export async function changePassword(input: z.infer<typeof changePasswordSchema>) {
  const profile = await requireProfile();
  const data = changePasswordSchema.parse(input);

  const { users } = await import("@/lib/db/schema/auth");
  const { hashPassword, verifyPassword } = await import("@/lib/auth-v2/password");

  // Ambil current hash
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, profile.id));
  if (!user) throw new Error("User not found");

  // Kalau sudah punya password → wajib verify current
  if (user.passwordHash) {
    if (!data.currentPassword) {
      throw new Error("Current password is required");
    }
    const ok = await verifyPassword(data.currentPassword, user.passwordHash);
    if (!ok) throw new Error("Current password is incorrect");
  }

  // Hash + save
  const newHash = await hashPassword(data.newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, profile.id));

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Cek apakah user sudah punya password (untuk UI decide section "Set password"
 * vs "Ubah password").
 */
export async function userHasPassword(): Promise<boolean> {
  const profile = await requireProfile();
  const { users } = await import("@/lib/db/schema/auth");

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, profile.id));
  return !!user?.passwordHash;
}

// ============================================================
// AVATAR UPLOAD
// ============================================================

const ACCEPTED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // iPhone modern default — convert ke JPEG server-side dulu sebelum sharp
  "image/heic",
  "image/heif",
] as const;
const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10MB pre-process (HEIC bisa besar)

/**
 * Beberapa browser/OS kirim MIME type kosong atau "application/octet-stream"
 * untuk HEIC dari iPhone. Fallback detect via extension nama file.
 */
function isHeicFile(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * Upload avatar foto.
 *
 * Flow:
 * 1. Validate file (type, size)
 * 2. Resize ke 256×256 cover crop + convert ke WebP via sharp
 * 3. Hapus avatar lama (kalau ada) supaya tidak menumpuk
 * 4. Upload ke storage adapter (local disk MVP)
 * 5. Update profiles.avatar_url
 *
 * Pakai FormData supaya bisa terima File langsung dari Client Component.
 */
export async function uploadAvatar(formData: FormData): Promise<{ avatarUrl: string }> {
  const profile = await requireProfile();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Invalid file");
  }
  if (file.size === 0) {
    throw new Error("File is empty");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error(
      `File is too large (max ${Math.floor(MAX_AVATAR_BYTES / 1024 / 1024)}MB)`
    );
  }
  const heic = isHeicFile(file);
  const validMime = ACCEPTED_AVATAR_TYPES.includes(
    file.type as (typeof ACCEPTED_AVATAR_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("File must be JPG, PNG, WebP, or HEIC");
  }

  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  // Read file → kalau HEIC, convert ke JPEG dulu (sharp tidak support HEIC
  // dari npm install — perlu libheif system-wide, tidak portable).
  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  // Process: resize 256×256 cover → webp quality 80
  const outputBuffer = await sharp(inputBuffer)
    .rotate() // auto-rotate berdasarkan EXIF (foto dari HP sering miring)
    .resize(256, 256, { fit: "cover", position: "center" })
    .webp({ quality: 80 })
    .toBuffer();

  // Hapus avatar lama kalau ada
  const [oldRow] = await db
    .select({ avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  if (oldRow?.avatarUrl) {
    await storage.delete(oldRow.avatarUrl);
  }

  // Upload baru
  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "avatars",
    key: profile.id,
    contentType: "image/webp",
  });

  // Cache-bust: append timestamp supaya browser refresh image kalau user upload ulang
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;

  await db
    .update(profiles)
    .set({ avatarUrl: versionedUrl })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");

  return { avatarUrl: versionedUrl };
}

// Foto profil (galeri): maks 3, tiap ≤4MB (pre-process). Server tetap kompres
// (resize 1080px + webp q80) sbg jaring kedua walau client sudah kompres.
const MAX_PROFILE_PHOTOS = 3;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** Tambah 1 foto ke galeri profil. Foto pertama otomatis jadi avatar utama. */
export async function uploadProfilePhoto(
  formData: FormData
): Promise<{ photos: string[]; avatarUrl: string | null }> {
  const profile = await requireProfile();
  const file = formData.get("file");

  if (!(file instanceof File)) throw new Error("Invalid file");
  if (file.size === 0) throw new Error("File is empty");
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(
      `File is too large (max ${Math.floor(MAX_PHOTO_BYTES / 1024 / 1024)}MB)`
    );
  }
  const heic = isHeicFile(file);
  const validMime = ACCEPTED_AVATAR_TYPES.includes(
    file.type as (typeof ACCEPTED_AVATAR_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("File must be JPG, PNG, WebP, or HEIC");
  }

  const [row] = await db
    .select({ photos: profiles.photos, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  const current = row?.photos ?? [];
  if (current.length >= MAX_PROFILE_PHOTOS) {
    throw new Error(`You can add up to ${MAX_PROFILE_PHOTOS} photos`);
  }

  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  // Resize maks 1080px (sisi terpanjang, tak upscale) → webp q80.
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(1080, 1080, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "photos",
    // key unik per foto (profileId + index + waktu) supaya tak overwrite.
    key: `${profile.id}-${current.length}-${Date.now()}`,
    contentType: "image/webp",
  });

  const photos = [...current, publicUrl];
  // Foto pertama = avatar utama (kalau belum ada avatar).
  const nextAvatar =
    photos.length === 1 ? `${publicUrl}?v=${Date.now()}` : row?.avatarUrl ?? null;

  await db
    .update(profiles)
    .set({ photos, avatarUrl: nextAvatar })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { photos, avatarUrl: nextAvatar };
}

/** Hapus 1 foto galeri (by index). Kalau foto[0] dihapus, avatar ikut geser. */
export async function removeProfilePhoto(
  index: number
): Promise<{ photos: string[]; avatarUrl: string | null }> {
  const profile = await requireProfile();
  const [row] = await db
    .select({ photos: profiles.photos, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  const current = row?.photos ?? [];
  if (index < 0 || index >= current.length) {
    throw new Error("Photo not found");
  }

  const { storage } = await import("@/lib/storage");
  const removedUrl = current[index];
  const photos = current.filter((_, i) => i !== index);

  // Avatar mengikuti foto[0]. Kalau foto pertama berubah/hilang → update avatar.
  const nextAvatar =
    photos.length > 0 ? `${photos[0]}?v=${Date.now()}` : null;

  await db
    .update(profiles)
    .set({ photos, avatarUrl: nextAvatar })
    .where(eq(profiles.id, profile.id));

  // Hapus file dari storage (best-effort) — tapi jangan hapus kalau URL masih
  // dipakai foto lain (tak mungkin, key unik) — aman.
  try {
    await storage.delete(removedUrl);
  } catch {
    /* ignore */
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { photos, avatarUrl: nextAvatar };
}

/**
 * Hapus avatar (kembali ke initials fallback).
 */
export async function deleteAvatar(): Promise<void> {
  const profile = await requireProfile();
  const { storage } = await import("@/lib/storage");

  const [row] = await db
    .select({ avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));

  if (row?.avatarUrl) {
    await storage.delete(row.avatarUrl);
  }

  await db
    .update(profiles)
    .set({ avatarUrl: null })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
}
