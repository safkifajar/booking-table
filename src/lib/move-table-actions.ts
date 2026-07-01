"use server";

import { z } from "zod";
import { and, asc, eq, ne, sql, inArray, isNotNull, lt, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { menuItems } from "@/lib/db/schema/menu";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile } from "@/lib/auth-v2/current";
import { isDbConstraintError } from "@/lib/utils";
import { getPaymentGateway } from "@/lib/payments/gateway";
import { generateAvailableSlots } from "@/lib/reservation-helpers";
import type { AvailableSlot } from "@/lib/reservation-format";
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import type { PaymentMethod } from "@/types/db";

/**
 * Pindah meja — FASE 1.
 *
 * Aturan fase ini:
 * - Hanya untuk sesi berstatus 'reserved' (belum masuk jam booking) → pindah
 *   LANGSUNG tanpa approval, oleh HOST sesi.
 * - Status aktif (open/locked) → DITOLAK di fase ini (akan butuh approval di
 *   fase berikutnya).
 *
 * Teknis: ganti table_id sesi. Waktu reservasi (reservation_at/end) dibiarkan
 * sama → durasi otomatis identik. Constraint DB no_overlapping_reservation
 * menjaga meja tujuan tak bentrok.
 */

export interface MoveTargetTable {
  id: string;
  label: string;
  area_name: string;
  capacity: number;
  min_spend: number;
}

/**
 * Daftar meja tujuan yg valid untuk dipindahi sesi ini: aktif, di bar sama,
 * bukan meja sekarang, kapasitas cukup, dan slot waktu (rentang reservasi sesi)
 * TIDAK bentrok dgn sesi reserved/open/locked lain.
 */
export async function getMoveTargets(
  sessionId: string
): Promise<MoveTargetTable[]> {
  const profile = await requireProfile();

  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));
  if (!session) return [];
  // Host sesi ATAU staff aktif di bar sesi ini (utk fitur pindah oleh staff).
  if (session.hostId !== profile.id) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, session.barId),
          eq(staffRoles.isActive, true)
        )
      );
    if (!staff) return [];
  }

  // Mode AKTIF (open/locked): pindah pertahankan JAM BOOKING ASLI & tak ada step
  // pilih jam, jadi meja yg bentrok di rentang booking [start, end] HARUS
  // disembunyikan di sini. Mode reserved: tampilkan semua, ketersediaan dipilih
  // di step jam.
  const isActive = session.status === "open" || session.status === "locked";
  const busyTableIds = new Set<string>();
  if (isActive && session.reservationAt && session.reservationEndAt) {
    const start = session.reservationAt;
    const end = session.reservationEndAt;
    const overlapping = await db
      .select({ tableId: tableSessions.tableId })
      .from(tableSessions)
      .where(
        and(
          inArray(tableSessions.status, ["reserved", "open", "locked"]),
          ne(tableSessions.id, session.id),
          isNotNull(tableSessions.reservationAt),
          isNotNull(tableSessions.reservationEndAt),
          lt(tableSessions.reservationAt, end),
          gt(tableSessions.reservationEndAt, start)
        )
      );
    for (const r of overlapping) busyTableIds.add(r.tableId);
  }

  // Jumlah anggota (utk filter kapasitas).
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, session.id),
        ne(sessionMembers.status, "pending")
      )
    );

  // TAMPILKAN SEMUA meja (kapasitas cukup), JANGAN sembunyikan meja yg sebagian
  // jamnya terisi — meja bisa punya slot jam lain yg kosong. Ketersediaan
  // per-jam ditangani di step pilih jam (getMoveTableSlots), sama spt booking.
  const rows = await db
    .select({
      id: tables.id,
      label: tables.label,
      area_name: floorAreas.name,
      capacity: tables.capacity,
      min_spend: tables.minSpend,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, session.barId),
        eq(tables.isActive, true),
        ne(tables.id, session.tableId)
      )
    )
    .orderBy(asc(floorAreas.sortOrder), asc(tables.label));

  return rows
    .filter((r) => r.capacity >= cnt && !busyTableIds.has(r.id))
    .map((r) => ({
      id: r.id,
      label: r.label,
      area_name: r.area_name,
      capacity: r.capacity,
      min_spend: r.min_spend ?? 0,
    }));
}

export interface MoveSlotData {
  slots: AvailableSlot[];
  /** ISO slot ter-booking di meja tujuan (utk picker konsisten dgn open table). */
  bookedSlotIsos: string[];
  slotIntervalMinutes: number;
  bookingWindowDays: number;
  /** Durasi booking awal (menit) — end dikunci = mulai + durasi. */
  durationMinutes: number;
}

/**
 * Data slot meja tujuan untuk picker pindah meja — DURASI dikunci = durasi
 * booking awal. Konsisten dgn picker open table (SlotRangePicker).
 */
export async function getMoveTableSlots(
  sessionId: string,
  targetTableId: string
): Promise<MoveSlotData> {
  const empty: MoveSlotData = {
    slots: [],
    bookedSlotIsos: [],
    slotIntervalMinutes: 60,
    bookingWindowDays: 7,
    durationMinutes: 60,
  };
  const profile = await requireProfile();

  const [session] = await db
    .select({
      hostId: tableSessions.hostId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));
  if (
    !session ||
    session.hostId !== profile.id ||
    !session.reservationAt ||
    !session.reservationEndAt
  )
    return empty;

  const durationMs =
    session.reservationEndAt.getTime() - session.reservationAt.getTime();

  // Config + jam operasi bar.
  const [barRow] = await db
    .select({
      opening_hours: bars.openingHours,
      reservation_config: bars.reservationConfig,
    })
    .from(bars)
    .where(eq(bars.id, session.barId));
  const opHours: OperatingHours = {
    ...DEFAULT_OPERATING_HOURS,
    ...((barRow?.opening_hours as OperatingHours) ?? {}),
  };
  const resConfig: ReservationConfig = {
    ...DEFAULT_RESERVATION_CONFIG,
    ...((barRow?.reservation_config as Partial<ReservationConfig>) ?? {}),
  };
  if (!resConfig.enabled) return empty;

  const slots = generateAvailableSlots(new Date(), resConfig, opHours);

  // Rentang booked di meja tujuan (reserved/open/locked, kecuali sesi ini).
  const booked = await db
    .select({
      startAt: tableSessions.reservationAt,
      endAt: tableSessions.reservationEndAt,
    })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tableId, targetTableId),
        inArray(tableSessions.status, ["reserved", "open", "locked"]),
        ne(tableSessions.id, sessionId),
        isNotNull(tableSessions.reservationAt),
        isNotNull(tableSessions.reservationEndAt)
      )
    );
  const ranges = booked
    .filter((b) => b.startAt && b.endAt)
    .map((b) => ({ s: b.startAt!.getTime(), e: b.endAt!.getTime() }));

  // bookedSlotIsos: tiap slot interval yg jatuh dalam rentang booked → ditandai
  // (picker SlotRangePicker pakai ini untuk disable, konsisten dgn open table).
  const bookedSlotIsos: string[] = [];
  for (const slot of slots) {
    const s = new Date(slot.iso).getTime();
    if (ranges.some((r) => s < r.e && r.s <= s)) bookedSlotIsos.push(slot.iso);
  }

  return {
    slots,
    bookedSlotIsos,
    slotIntervalMinutes: resConfig.slotIntervalMinutes,
    bookingWindowDays: resConfig.bookingWindowDays,
    durationMinutes: Math.round(durationMs / 60000),
  };
}

const moveSchema = z.object({
  sessionId: z.string().uuid(),
  targetTableId: z.string().uuid(),
  /** ISO jam mulai baru di meja tujuan. Wajib. End = mulai + durasi awal. */
  reservationAt: z.string().datetime(),
});

export async function moveTable(input: z.infer<typeof moveSchema>) {
  const profile = await requireProfile();
  const data = moveSchema.parse(input);

  // 1. Ambil sesi + meja asal (+ bar).
  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, data.sessionId));

  if (!session) throw new Error("Session not found");
  if (session.hostId !== profile.id) {
    throw new Error("Only the host can move the table");
  }
  if (session.tableId === data.targetTableId) {
    throw new Error("Destination table is the same as the current one");
  }

  // 2. Fase 1: hanya status 'reserved' yg boleh pindah mandiri.
  if (session.status !== "reserved") {
    throw new Error(
      "Table is already active. Moving while active needs staff approval (coming soon)."
    );
  }

  // 3. Validasi meja tujuan: aktif, di bar yg sama, kapasitas cukup.
  const [target] = await db
    .select({
      id: tables.id,
      label: tables.label,
      capacity: tables.capacity,
      isActive: tables.isActive,
      barId: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, data.targetTableId));

  if (!target) throw new Error("Invalid destination table");
  if (!target.isActive) throw new Error("Destination table is inactive");
  if (target.barId !== session.barId) {
    throw new Error("Destination table is in a different bar");
  }

  // Kapasitas: jumlah anggota joined/left harus muat.
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, session.id),
        ne(sessionMembers.status, "pending")
      )
    );
  if (cnt > target.capacity) {
    throw new Error(
      `Table ${target.label}'s capacity (${target.capacity}) isn't enough for ${cnt} guests.`
    );
  }

  // 4. Hitung jam baru: durasi dikunci = durasi booking awal.
  if (!session.reservationAt || !session.reservationEndAt) {
    throw new Error("This session has no booking time range");
  }
  const durationMs =
    session.reservationEndAt.getTime() - session.reservationAt.getTime();
  const newStart = new Date(data.reservationAt);
  const newEnd = new Date(newStart.getTime() + durationMs);

  // 5. Eksekusi: ganti table_id + jam baru. Constraint DB jaga overlap.
  try {
    await db
      .update(tableSessions)
      .set({
        tableId: data.targetTableId,
        reservationAt: newStart,
        reservationEndAt: newEnd,
      })
      .where(eq(tableSessions.id, session.id));
  } catch (err) {
    if (isDbConstraintError(err, "no_overlapping_reservation")) {
      throw new Error(
        `Table ${target.label}'s time slot is already booked. Pick another time/table.`
      );
    }
    if (isDbConstraintError(err, "uq_active_session_per_table")) {
      throw new Error(`Table ${target.label} is currently in use.`);
    }
    throw err;
  }

  // 5. Realtime: meja lama & baru berubah → refresh floor/sesi.
  await Promise.allSettled([
    notify(channels.session(session.id)),
    notify(channels.bar(session.barId)),
    notify(channels.staff(session.barId)),
  ]);

  revalidatePath(`/session/${session.id}`);
  revalidatePath("/bar/[slug]", "page");
}

// ============================================================
// PINDAH + ORDER (meja tujuan ber-min-spend, kurang → bayar selisih dulu)
// ============================================================

const moveWithOrderSchema = z.object({
  sessionId: z.string().uuid(),
  targetTableId: z.string().uuid(),
  reservationAt: z.string().datetime(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1, "Add at least 1 item"),
  paymentMethod: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
});

export async function moveTableWithOrder(
  input: z.infer<typeof moveWithOrderSchema>
) {
  const profile = await requireProfile();
  const data = moveWithOrderSchema.parse(input);

  // 1. Sesi + meja asal + bar.
  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, data.sessionId));
  if (!session) throw new Error("Session not found");
  if (session.hostId !== profile.id)
    throw new Error("Only the host can move the table");
  if (session.status !== "reserved")
    throw new Error("Table is already active. Moving while active needs staff approval.");
  if (session.tableId === data.targetTableId)
    throw new Error("Destination table is the same as the current one");
  if (!session.reservationAt || !session.reservationEndAt)
    throw new Error("This session has no booking time range");
  const durationMs =
    session.reservationEndAt.getTime() - session.reservationAt.getTime();
  const newStart = new Date(data.reservationAt);
  const newEnd = new Date(newStart.getTime() + durationMs);

  // 2. Meja tujuan + min_spend.
  const [target] = await db
    .select({
      id: tables.id,
      label: tables.label,
      capacity: tables.capacity,
      isActive: tables.isActive,
      minSpend: tables.minSpend,
      barId: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, data.targetTableId));
  if (!target || !target.isActive) throw new Error("Destination table is unavailable");
  if (target.barId !== session.barId) throw new Error("Destination table is in a different bar");
  const minSpend = target.minSpend ?? 0;

  // 3. Resolve item baru + harga dari DB (jangan percaya harga client).
  const ids = data.items.map((i) => i.menuItemId);
  const menuRows = await db
    .select({
      id: menuItems.id,
      price: menuItems.price,
      is_available: menuItems.isAvailable,
    })
    .from(menuItems)
    .where(inArray(menuItems.id, ids));
  const priceMap = new Map(menuRows.map((m) => [m.id, m]));
  let addedTotal = 0;
  const resolved = data.items.map((i) => {
    const m = priceMap.get(i.menuItemId);
    if (!m || !m.is_available) throw new Error("Menu item unavailable");
    addedTotal += m.price * i.quantity;
    return { menuItemId: i.menuItemId, quantity: i.quantity, unitPrice: m.price };
  });

  // 4. Total existing order sesi ini.
  const [existing] = await db
    .select({
      total: sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.sessionId, session.id), ne(orderItems.status, "void")));
  const existingTotal = Number(existing?.total ?? 0);

  // 5. Validasi: total akhir wajib >= min-spend.
  if (existingTotal + addedTotal < minSpend) {
    throw new Error(
      `Minimum spend for table ${target.label} (${minSpend}) not reached. Add more orders.`
    );
  }

  // 6. Transaksi: pastikan ada order, insert items, insert payment (pending),
  //    pindah meja. Gateway charge di luar tx.
  let paymentId: string | null = null;
  try {
    paymentId = await db.transaction(async (tx) => {
      // host member id
      const [hostMember] = await tx
        .select({ id: sessionMembers.id })
        .from(sessionMembers)
        .where(
          and(
            eq(sessionMembers.sessionId, session.id),
            eq(sessionMembers.profileId, profile.id)
          )
        );
      if (!hostMember) throw new Error("Host member not found");

      // order sesi (ambil atau buat)
      let [order] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.sessionId, session.id))
        .limit(1);
      if (!order) {
        [order] = await tx
          .insert(orders)
          .values({ sessionId: session.id, status: "open" })
          .returning({ id: orders.id });
      }

      await tx.insert(orderItems).values(
        resolved.map((it) => ({
          orderId: order.id,
          menuItemId: it.menuItemId,
          addedByMemberId: hostMember.id,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          status: "sent" as const,
        }))
      );

      // Payment utk order tambahan (bayar selisih min-spend).
      const [pay] = await tx
        .insert(payments)
        .values({
          orderId: order.id,
          paidByMemberId: hostMember.id,
          amount: addedTotal,
          method: data.paymentMethod,
          status: "pending",
          splitMode: "custom",
          splitMeta: { moveTableOrder: true },
          paidAt: null,
        })
        .returning({ id: payments.id });

      // Pindah meja + jam baru (durasi dikunci).
      await tx
        .update(tableSessions)
        .set({
          tableId: data.targetTableId,
          reservationAt: newStart,
          reservationEndAt: newEnd,
        })
        .where(eq(tableSessions.id, session.id));

      return pay.id;
    });
  } catch (err) {
    if (isDbConstraintError(err, "no_overlapping_reservation")) {
      throw new Error(`Table ${target.label}'s slot is already booked. Pick another.`);
    }
    if (isDbConstraintError(err, "uq_active_session_per_table")) {
      throw new Error(`Table ${target.label} is currently in use.`);
    }
    throw err;
  }

  // 7. Charge gateway (best-effort, di luar tx). Mock → langsung paid.
  if (paymentId) {
    try {
      const gateway = getPaymentGateway();
      const charge = await gateway.createCharge({
        paymentId,
        amount: addedTotal,
        method: data.paymentMethod as PaymentMethod,
        payerName: profile.displayName,
        description: `Order pindah ke meja ${target.label}`,
      });
      await db
        .update(payments)
        .set({
          externalRef: charge.externalRef,
          status: charge.status,
          paidAt: charge.status === "paid" ? new Date() : null,
        })
        .where(eq(payments.id, paymentId));
    } catch {
      // Pindah & order tetap tercatat; pembayaran bisa dikonfirmasi manual.
    }
  }

  await Promise.allSettled([
    notify(channels.session(session.id)),
    notify(channels.bar(session.barId)),
    notify(channels.staff(session.barId)),
  ]);
  revalidatePath(`/session/${session.id}`);
  revalidatePath("/bar/[slug]", "page");
}
