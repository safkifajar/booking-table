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
import { and, eq, inArray, isNull, isNotNull, ne, sql, desc } from "drizzle-orm";
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
import {
  isSessionHost,
  assertHostOrActiveStaff,
  assertActiveStaffOfSession,
} from "@/lib/auth-v2/session-auth";
import { formatIDR, isDbConstraintError } from "@/lib/utils";
import * as membershipActions from "@/lib/session-membership-actions";
import {
  notifySessionAndStaff,
  recordSessionInvites,
} from "@/lib/session-shared";
import * as profileActions from "@/lib/profile-actions";
import * as orderActions from "@/lib/order-actions";
import * as paymentActions from "@/lib/payment-actions";
import {
  createNotification,
} from "@/lib/notifications";
import {
  settleOverdueIfPaid,
  getOrderOutstanding,
  settleOrderIfPaid,
  DP_TIMEOUT_SECONDS,
  PAY_AT_CASHIER_TIMEOUT_SECONDS,
} from "@/lib/queries";
import {
  notifyPaymentEvent,
  notifyCashiersPayAtCashier,
  notifySplitMembers,
} from "@/lib/payment-notify";
import {
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
          "Vouchers apply to payments. Use it when paying your table bill instead.",
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
          "This voucher covers more than the deposit. Save it for the bill payment instead.",
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
            splitMeta: {
              isDownPayment: true,
              ...(dpIsFullPrepay ? { dpFull: true } : {}),
            },
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
  /** reference = ID transaksi milik gateway (Duitku), utk dilacak di
   *  dashboard/simulator gateway. Beda dari paymentId kita. */
  let dpQris: {
    paymentId: string;
    qrString: string;
    reference: string | null;
  } | null = null;
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
      // Kabari kasir: ada DP booking yang mau dibayar di kasir.
      await notifyCashiersPayAtCashier({
        paymentId: dpPaymentId,
        isDownPayment: true,
      });
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
            // Sama seperti jalur pay-at-cashier: DP yang melunasi SELURUH
            // tagihan ditandai dpFull supaya tampil sbg "Bill", bukan "DP".
            // Tanpa ini, bayar 100% lewat QRIS tetap berlabel DP — update ini
            // menimpa splitMeta, jadi flagnya harus ditulis ulang di sini.
            ...(dpIsFullPrepay ? { dpFull: true } : {}),
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
        dpQris = {
          paymentId: dpPaymentId,
          qrString: chargeResult.qrString,
          reference: chargeResult.externalRef || null,
        };
      }
    } catch (err) {
      console.error("[openTable] DP gateway charge failed:", err);
      // Lepas reservasi voucher — DP akan ditangani manual tanpa diskon ini.
      await releaseVoucherForPayment(dpPaymentId).catch(() => {});
      // Buang baris pending-nya juga. Tanpa itu ia tak pernah punya
      // expiresAt, dan penjagaan anti-bayar-ganda menganggapnya "masih
      // hidup" selamanya — tagihan terkunci & tamu tak bisa mencoba lagi.
      await db
        .delete(payments)
        .where(eq(payments.id, dpPaymentId))
        .catch(() => {});
      // Don't throw — session tetap exist, staff bisa handle manual
    }
    }
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath("/bar/[slug]", "page");

  // 10. Undangan ke user yg diundang — HANYA kalau tak menunggu pembayaran DP.
  //     Booking dgn DP pending (QRIS belum dibayar / pay-at-cashier belum
  //     dikonfirmasi) JANGAN kirim undangan dulu: booking bisa batal / timeout.
  //     Untuk kasus itu, undangan dikirim di titik settle DP (checkPaymentStatus,
  //     cashierMarkPaymentPaid, markPaymentPaidBySystem, staffOpenTableForCustomer)
  //     lewat sendBookingInvites — hanya saat DP benar-benar lunas.
  //     Kirim sekarang kalau: walk-in / tanpa DP / DP sudah paid seketika.
  const dpStillPending = dpAwaitCashier || !!dpQris;
  if (invitees.length > 0 && !dpStillPending) {
    await sendBookingInvites(sessionId);
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

/**
 * Kirim undangan (notif in-app + email) ke SEMUA member 'pending' berundang
 * (invitedBy not null) di sebuah sesi — self-contained (baca data dari DB via
 * sessionId, tak butuh state in-memory).
 *
 * Dipakai untuk booking yang butuh DP: undangan hanya dikirim SETELAH DP lunas,
 * bukan saat booking dibuat (yang mungkin belum dibayar / batal). Idempotensi
 * dijamin PEMANGGIL — dipanggil hanya pada transisi dp_paid_at null→terisi
 * (sekali seumur booking), jadi tak perlu penanda per-member.
 *
 * Best-effort: kegagalan notif/email tak boleh menggagalkan alur pembayaran.
 */
export async function sendBookingInvites(sessionId: string): Promise<void> {
  // Host (pengundang) + meja + bar untuk isi teks undangan.
  const [meta] = await db
    .select({
      hostId: tableSessions.hostId,
      hostName: profiles.displayName,
      tableLabel: tables.label,
      barName: bars.name,
    })
    .from(tableSessions)
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tableSessions.id, sessionId));
  if (!meta) return;

  // Member yang diundang & masih pending (belum accept/decline) + email +
  // pengundang (untuk arsip).
  const invited = await db
    .select({
      profileId: sessionMembers.profileId,
      email: users.email,
      invitedBy: sessionMembers.invitedBy,
    })
    .from(sessionMembers)
    .innerJoin(users, eq(users.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending"),
        isNotNull(sessionMembers.invitedBy)
      )
    );
  if (invited.length === 0) return;

  // Arsip undangan (record /profile/invites). Upsert: undang-ulang orang yg sama
  // ke sesi ini reset ke pending. invitedAt = sekarang (waktu undangan benar-2
  // dikirim = setelah DP lunas), respondedAt di-null-kan.
  await recordSessionInvites(
    sessionId,
    invited
      .filter((u) => u.invitedBy)
      .map((u) => ({ inviterId: u.invitedBy as string, inviteeId: u.profileId }))
  ).catch((e) => console.error("[invite] archive booking:", e));

  const link = `/session/${sessionId}`;
  const tableLabel = meta.tableLabel ?? "table";
  await Promise.allSettled(
    invited.map(async (u) => {
      await createNotification({
        profileId: u.profileId,
        type: "table_invite",
        title: `${meta.hostName} invited you to table ${tableLabel}`,
        body: `Open to accept the invite to table ${tableLabel}.`,
        link,
        actorId: meta.hostId, // foto pengundang di list notifikasi
      });
      const tpl = tableInviteEmail({
        email: u.email,
        inviterName: meta.hostName,
        tableLabel,
        barName: meta.barName ?? "SOHO",
        link,
        mode: "invited",
      });
      await sendEmail({
        to: u.email,
        subject: `Invite to table ${tableLabel}`,
        kind: "table_invite",
        html: tpl.html,
        text: tpl.text,
      });
    })
  );
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
  /**
   * Referensi dari gateway (mis. Duitku). Dipakai layar QR untuk menampilkan
   * "Reference: DS327..." alih-alih UUID internal kita — nomor inilah yang
   * bisa ditelusuri tamu & kasir di sisi gateway. NULL kalau gateway tak
   * memberi (atau pembayaran dibuat tanpa gateway, mis. pay-at-cashier).
   */
  externalRef: string | null;
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
  let order: { id: string; ownerMemberId: string | null } | undefined;
  if (data.orderId) {
    const [byId] = await db
      .select({ id: orders.id, ownerMemberId: orders.ownerMemberId })
      .from(orders)
      .where(and(eq(orders.id, data.orderId), eq(orders.sessionId, data.sessionId)));
    order = byId;
    if (!order) throw new Error("Order not found for this table");
  } else {
    // Fallback tanpa orderId → HARUS order MEJA. Order terbaru di sesi bisa
    // saja milik anggota; tanpa filter ini host membayar/menyplit order orang.
    const [openOrder] = await db
      .select({ id: orders.id, ownerMemberId: orders.ownerMemberId })
      .from(orders)
      .where(
        and(
          eq(orders.sessionId, data.sessionId),
          ne(orders.status, "closed"),
          ne(orders.status, "cancelled"),
          isNull(orders.ownerMemberId)
        )
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    order = openOrder;
  }
  if (!order) throw new Error("No open order for this session");

  // Order milik ANGGOTA tak boleh di-split — dia wajib membayarnya sendiri,
  // penuh. Tanpa penjagaan ini host bisa membagi pesanan pribadi anggota ke
  // seluruh meja, persis kebalikan dari aturan fitur ini.
  if (order.ownerMemberId) {
    throw new Error("A member's own order can't be split, they pay it in full");
  }

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
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: 0, status: "skipped", qrString: null, expiresAt: null, externalRef: null, note: "Nothing to pay" });
      continue;
    }
    if (hasActivePending.has(t.memberId)) {
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: t.amount, status: "skipped", qrString: null, expiresAt: null, externalRef: null, note: "Already has a pending payment" });
      continue;
    }
    // Dideklarasikan DI LUAR try supaya blok catch bisa membuang barisnya.
    let pay: { id: string } | undefined;
    try {
      [pay] = await db
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
        // Batas 10 mnt (sama dgn payShare cash) → sumber countdown + lazy-expire.
        const batchExpiresAt = new Date(
          Date.now() + PAY_AT_CASHIER_TIMEOUT_SECONDS * 1000
        ).toISOString();
        await db
          .update(payments)
          .set({
            externalRef: `cashier_${pay.id}`,
            splitMeta: { batchId, payAtCashier: true, expiresAt: batchExpiresAt },
          })
          .where(eq(payments.id, pay.id));
        results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: pay.id, amount: t.amount, status: "pending", qrString: null, expiresAt: batchExpiresAt, externalRef: null });
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

      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: pay.id, amount: t.amount, status: cr.status, qrString: cr.qrString ?? null, expiresAt: cr.expiresAt ?? null, externalRef: cr.externalRef ?? null });
    } catch (err) {
      console.error("[createSplitBatch] gagal utk member", t.memberId, err);
      // Buang baris pending-nya — lihat catatan di payShare: pending tanpa
      // expiresAt mengunci tagihan selamanya bagi anggota ini.
      if (pay?.id) {
        await db.delete(payments).where(eq(payments.id, pay.id)).catch(() => {});
      }
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: t.amount, status: "error", qrString: null, expiresAt: null, externalRef: null, note: "Gateway error" });
    }
  }

  // Prepaid hook: kalau order kini lunas (semua share paid) → order MASUK.
  await settleOrderIfPaid(order.id);
  // Kalau ada yang langsung paid (mock) & sesi overdue → settle.
  if (results.some((r) => r.status === "paid")) {
    await settleOverdueIfPaid(data.sessionId);
  }

  await notifySessionAndStaff(data.sessionId);

  // Kabari tiap ANGGOTA bahwa bagiannya siap dibayar. notifySessionAndStaff di
  // atas hanya menyegarkan layar lewat SSE — anggota yang tak sedang membuka
  // aplikasi tak tahu apa-apa. Host dilewati di dalam fungsinya (QRIS-nya
  // sudah terpampang di layarnya sendiri).
  await notifySplitMembers({
    sessionId: data.sessionId,
    orderId: order.id,
    members: results
      .filter((r) => r.paymentId && r.status === "pending")
      .map((r) => ({ memberId: r.memberId, amount: r.amount })),
  });

  // Split bayar-di-kasir: kabari kasir SEKALI (bukan per anggota) kalau ada
  // share pay-at-cashier yang pending.
  if (data.method === "cash") {
    const firstCashier = results.find(
      (r) => r.status === "pending" && r.paymentId
    );
    if (firstCashier?.paymentId) {
      await notifyCashiersPayAtCashier({
        paymentId: firstCashier.paymentId,
        isDownPayment: false,
      });
    }
  }
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
  /** Referensi gateway — layar QR menampilkannya alih-alih UUID internal. */
  externalRef: string | null;
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
      throw new Error("That payment was actually paid. No new QRIS needed.");
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
    body: `Your previous QRIS expired. A new one for ${formatIDR(amount)} is ready. Tap to pay.`,
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
    externalRef: charge.externalRef ?? null,
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
      orderId: payments.orderId,
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
      // Guard transisi null→terisi (returning) → undangan hanya sekali. Booking
      // dgn undangan: user diundang baru dinotifikasi SETELAH DP lunas.
      const dpSet = await db
        .update(tableSessions)
        .set({ dpPaidAt: new Date() })
        .where(
          and(
            eq(tableSessions.id, row.sessionId),
            isNull(tableSessions.dpPaidAt)
          )
        )
        .returning({ id: tableSessions.id });
      if (dpSet.length > 0) {
        await sendBookingInvites(row.sessionId).catch((e) =>
          console.error("[invite] checkPaymentStatus:", e)
        );
      }
    }
    // Prepaid hook: order 'unpaid' + kini ada pembayaran lunas → order MASUK
    // (status 'paid' + item draft→sent). WAJIB sama seperti jalur webhook
    // (markPaymentPaidBySystem) — tanpa ini, pembayaran yang dikenali lewat
    // polling ("cek status", saat callback Duitku tak sampai) meninggalkan
    // order 'unpaid' selamanya: item tak pernah masuk dapur, dan order baru
    // menabrak uq_unpaid_order_per_session (crash render halaman order).
    await settleOrderIfPaid(row.orderId);
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
      paidByMemberId: payments.paidByMemberId,
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

  // Otorisasi: PEMILIK pembayaran (paid_by_member_id) ATAU host meja ATAU staff
  // aktif di bar. Dulu "member joined mana pun" — terlalu longgar: anggota lain
  // bisa membatalkan QRIS milik orang, dan itu kehilangan data yg tak terbalik.
  // Host tetap boleh (dia penanggung jawab tagihan meja).
  // Catatan: checkPaymentStatus SENGAJA tetap longgar (semua anggota boleh cek
  // status) — hanya AKSI merusak yang diperketat di sini.
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
  let allowed =
    !!asMember &&
    (asMember.id === row.paidByMemberId ||
      (await isSessionHost(row.sessionId, profile.id)));
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
): Promise<{
  status: "cancelled" | "already_paid";
  bookingCancelled?: boolean;
}> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      ownerMemberId: orders.ownerMemberId,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      dpPaidAt: tableSessions.dpPaidAt,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .where(eq(orders.id, orderId));
  if (!row) throw new Error("Order not found");

  // Order yg sudah lunas/closed tak boleh dibatalkan lewat sini.
  if (row.status === "paid" || row.status === "closed") {
    return { status: "already_paid" };
  }
  if (row.status === "cancelled") {
    return { status: "cancelled" }; // sudah batal → no-op
  }

  // Otorisasi:
  // - Order MEJA (owner NULL) → host meja atau staff aktif. Itu tagihan meja;
  //   anggota biasa tak boleh membatalkan order orang.
  // - Order milik ANGGOTA     → HANYA pemiliknya (staff tetap boleh, mereka
  //   yang menangani meja secara fisik). HOST TIDAK — dia membuka detail order
  //   anggota lalu menekan "kembali" bisa tanpa sengaja membatalkan pesanan
  //   orang lain.
  if (row.ownerMemberId) {
    const [me] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, row.sessionId),
          eq(sessionMembers.profileId, profile.id),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!me || me.id !== row.ownerMemberId) {
      // Bukan pemilik → boleh hanya kalau staff aktif di bar.
      await assertActiveStaffOfSession(row.sessionId, profile.id);
    }
  } else {
    await assertHostOrActiveStaff(row.sessionId, profile.id);
  }

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

  // Order ini punya DP booking yang belum terkonfirmasi? (mis. reservasi yg
  // DP-nya pay-at-cashier/QRIS belum dibayar). Kalau ya, membatalkan order =
  // membatalkan SELURUH booking: sesi 'reserved'/'open' + dp_paid_at NULL harus
  // ikut jadi 'cancelled', kalau tidak sesi 'reserved' yatim akan ke-promote
  // jadi 'open' (meja aktif) saat waktunya tiba. (Bug: cancel malah meja aktif.)
  const [pendingDp] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
      )
    )
    .limit(1);
  const cancelBooking =
    !!pendingDp &&
    row.dpPaidAt == null &&
    (row.sessionStatus === "reserved" || row.sessionStatus === "open");

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
    // Booking belum terkonfirmasi → batalkan sesinya juga (meja bebas lagi).
    if (cancelBooking) {
      await tx
        .update(tableSessions)
        .set({ status: "cancelled", closedAt: new Date() })
        .where(eq(tableSessions.id, row.sessionId));
    }
  });

  // Lepas reservasi voucher pada payment yang ikut dibatalkan (pasca-commit).
  for (const pRow of cancelledPaymentIds) {
    await releaseVoucherForPayment(pRow.id);
  }

  await notifySessionAndStaff(row.sessionId);
  revalidatePath(`/session/${row.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath("/staff/waiter");
  if (cancelBooking) revalidatePath("/bar/[slug]", "page");
  return { status: "cancelled", bookingCancelled: cancelBooking };
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

// ============================================================
// PROFIL PENGGUNA — dipindah ke profile-actions.ts
// ============================================================
//
// Diteruskan dari sini supaya 29 berkas yang sudah mengimpor dari
// "@/lib/actions" tak perlu disentuh. Impor BARU sebaiknya langsung ke
// "@/lib/profile-actions".
//
// Berkas "use server" hanya boleh mengekspor fungsi async, jadi ini ditulis
// sebagai pembungkus tipis — `export ... from` akan ditolak Next.js.

export async function updateProfile(
  ...args: Parameters<typeof profileActions.updateProfile>
) {
  return profileActions.updateProfile(...args);
}
export async function updateStaffProfile(
  ...args: Parameters<typeof profileActions.updateStaffProfile>
) {
  return profileActions.updateStaffProfile(...args);
}
export async function updatePrivacy(
  ...args: Parameters<typeof profileActions.updatePrivacy>
) {
  return profileActions.updatePrivacy(...args);
}
export async function completeOnboarding(
  ...args: Parameters<typeof profileActions.completeOnboarding>
) {
  return profileActions.completeOnboarding(...args);
}
export async function changePassword(
  ...args: Parameters<typeof profileActions.changePassword>
) {
  return profileActions.changePassword(...args);
}
export async function userHasPassword(
  ...args: Parameters<typeof profileActions.userHasPassword>
) {
  return profileActions.userHasPassword(...args);
}
export async function uploadAvatar(
  ...args: Parameters<typeof profileActions.uploadAvatar>
) {
  return profileActions.uploadAvatar(...args);
}
export async function uploadProfilePhoto(
  ...args: Parameters<typeof profileActions.uploadProfilePhoto>
) {
  return profileActions.uploadProfilePhoto(...args);
}
export async function removeProfilePhoto(
  ...args: Parameters<typeof profileActions.removeProfilePhoto>
) {
  return profileActions.removeProfilePhoto(...args);
}
export async function deleteAvatar(
  ...args: Parameters<typeof profileActions.deleteAvatar>
) {
  return profileActions.deleteAvatar(...args);
}

// ============================================================
// KEANGGOTAAN SESI — dipindah ke session-membership-actions.ts
// ============================================================
//
// Diteruskan supaya berkas yang sudah mengimpor dari "@/lib/actions" tak
// perlu disentuh. Impor BARU sebaiknya langsung ke modul itu.
//
// Ditulis sebagai pembungkus, bukan `export ... from`: berkas "use server"
// hanya boleh mengekspor fungsi async. Tipe MyInviteItem karena itu tak
// ikut — pemakainya mengimpor langsung dari modulnya.

export async function updateSessionInfo(
  ...args: Parameters<typeof membershipActions.updateSessionInfo>
) {
  return membershipActions.updateSessionInfo(...args);
}
export async function joinSession(
  ...args: Parameters<typeof membershipActions.joinSession>
) {
  return membershipActions.joinSession(...args);
}
export async function requestJoinSession(
  ...args: Parameters<typeof membershipActions.requestJoinSession>
) {
  return membershipActions.requestJoinSession(...args);
}
export async function approveJoinRequest(
  ...args: Parameters<typeof membershipActions.approveJoinRequest>
) {
  return membershipActions.approveJoinRequest(...args);
}
export async function rejectJoinRequest(
  ...args: Parameters<typeof membershipActions.rejectJoinRequest>
) {
  return membershipActions.rejectJoinRequest(...args);
}
export async function acceptInvite(
  ...args: Parameters<typeof membershipActions.acceptInvite>
) {
  return membershipActions.acceptInvite(...args);
}
export async function declineInvite(
  ...args: Parameters<typeof membershipActions.declineInvite>
) {
  return membershipActions.declineInvite(...args);
}
export async function inviteUsersToSession(
  ...args: Parameters<typeof membershipActions.inviteUsersToSession>
) {
  return membershipActions.inviteUsersToSession(...args);
}
export async function cancelInvite(
  ...args: Parameters<typeof membershipActions.cancelInvite>
) {
  return membershipActions.cancelInvite(...args);
}
export async function getMyInvites(
  ...args: Parameters<typeof membershipActions.getMyInvites>
) {
  return membershipActions.getMyInvites(...args);
}
export async function getMyPendingInviteCount(
  ...args: Parameters<typeof membershipActions.getMyPendingInviteCount>
) {
  return membershipActions.getMyPendingInviteCount(...args);
}
export async function leaveSession(
  ...args: Parameters<typeof membershipActions.leaveSession>
) {
  return membershipActions.leaveSession(...args);
}
export async function closeSession(
  ...args: Parameters<typeof membershipActions.closeSession>
) {
  return membershipActions.closeSession(...args);
}
export async function leaveSessionAndRate(
  ...args: Parameters<typeof membershipActions.leaveSessionAndRate>
) {
  return membershipActions.leaveSessionAndRate(...args);
}

// ============================================================
// PESANAN — dipindah ke order-actions.ts
// ============================================================
//
// Diteruskan dari sini supaya berkas yang sudah mengimpor dari
// "@/lib/actions" tak perlu disentuh. Impor BARU sebaiknya langsung ke
// "@/lib/order-actions".
//
// Berkas "use server" hanya boleh mengekspor fungsi async, jadi ini ditulis
// sebagai pembungkus tipis — `export ... from` akan ditolak Next.js.

export async function addOrderItem(
  ...args: Parameters<typeof orderActions.addOrderItem>
) {
  return orderActions.addOrderItem(...args);
}
export async function createOrder(
  ...args: Parameters<typeof orderActions.createOrder>
) {
  return orderActions.createOrder(...args);
}
export async function getSessionOrders(
  ...args: Parameters<typeof orderActions.getSessionOrders>
) {
  return orderActions.getSessionOrders(...args);
}
export async function getOrderDetail(
  ...args: Parameters<typeof orderActions.getOrderDetail>
) {
  return orderActions.getOrderDetail(...args);
}
export async function removeOrderItem(
  ...args: Parameters<typeof orderActions.removeOrderItem>
) {
  return orderActions.removeOrderItem(...args);
}

// ============================================================
// PEMBAYARAN — dipindah ke payment-actions.ts
// ============================================================
//
// Diteruskan dari sini supaya berkas yang sudah mengimpor dari
// "@/lib/actions" tak perlu disentuh. Impor BARU sebaiknya langsung ke
// "@/lib/payment-actions".
//
// Berkas "use server" hanya boleh mengekspor fungsi async, jadi ini ditulis
// sebagai pembungkus tipis — `export ... from` akan ditolak Next.js.

export async function payShare(
  ...args: Parameters<typeof paymentActions.payShare>
) {
  return paymentActions.payShare(...args);
}
