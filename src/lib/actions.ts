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
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { menuItems } from "@/lib/db/schema/menu";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { memberRatings, staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { requireProfile } from "@/lib/auth-v2/current";
import { isDbConstraintError } from "@/lib/utils";
import * as membershipActions from "@/lib/session-membership-actions";
import {
  notifySessionAndStaff,
  sendBookingInvites,
} from "@/lib/session-shared";
import * as profileActions from "@/lib/profile-actions";
import * as orderActions from "@/lib/order-actions";
import * as paymentActions from "@/lib/payment-actions";
import * as splitActions from "@/lib/split-actions";
import {
  settleOrderIfPaid,
  DP_TIMEOUT_SECONDS,
  PAY_AT_CASHIER_TIMEOUT_SECONDS,
} from "@/lib/queries";
import { notifyCashiersPayAtCashier } from "@/lib/payment-notify";
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
} from "@/lib/revenue-split";
import { getPaymentGateway } from "@/lib/payments/gateway";
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

// ============================================================
// SPLIT BATCH & TRANSAKSI — dipindah ke split-actions.ts
// ============================================================
//
// Diteruskan dari sini supaya berkas yang sudah mengimpor dari
// "@/lib/actions" tak perlu disentuh. Impor BARU sebaiknya langsung ke
// "@/lib/split-actions".
//
// Berkas "use server" hanya boleh mengekspor fungsi async, jadi ini ditulis
// sebagai pembungkus tipis — `export ... from` akan ditolak Next.js.

export async function createSplitBatch(
  ...args: Parameters<typeof splitActions.createSplitBatch>
) {
  return splitActions.createSplitBatch(...args);
}
export async function regenerateMemberPayment(
  ...args: Parameters<typeof splitActions.regenerateMemberPayment>
) {
  return splitActions.regenerateMemberPayment(...args);
}
export async function cancelSplitBatch(
  ...args: Parameters<typeof splitActions.cancelSplitBatch>
) {
  return splitActions.cancelSplitBatch(...args);
}
export async function getSessionPaymentDetail(
  ...args: Parameters<typeof splitActions.getSessionPaymentDetail>
) {
  return splitActions.getSessionPaymentDetail(...args);
}
export async function checkPaymentStatus(
  ...args: Parameters<typeof splitActions.checkPaymentStatus>
) {
  return splitActions.checkPaymentStatus(...args);
}
export async function cancelPayment(
  ...args: Parameters<typeof splitActions.cancelPayment>
) {
  return splitActions.cancelPayment(...args);
}
export async function cancelUnpaidOrder(
  ...args: Parameters<typeof splitActions.cancelUnpaidOrder>
) {
  return splitActions.cancelUnpaidOrder(...args);
}

