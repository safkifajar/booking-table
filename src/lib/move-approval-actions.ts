"use server";

import { z } from "zod";
import { and, desc, eq, ne, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { menuItems } from "@/lib/db/schema/menu";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { tableMoveRequests } from "@/lib/db/schema/move-requests";
import { staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { requireProfile } from "@/lib/auth-v2/current";
import { requirePermission } from "@/lib/auth-v2/permissions";
import { createNotification } from "@/lib/notifications";
import { getPaymentGateway } from "@/lib/payments/gateway";
import { isDbConstraintError } from "@/lib/utils";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import type { PaymentMethod } from "@/types/db";

// ============================================================
// FASE 2 — REQUEST & APPROVAL (sesi aktif)
// ============================================================

const requestSchema = z.object({
  sessionId: z.string().uuid(),
  targetTableId: z.string().uuid(),
});

/**
 * Host minta pindah meja saat sesi AKTIF (open/locked). Buat request pending +
 * notif ke semua staff bar. Tak langsung pindah — tunggu approval.
 *
 * Waktu: pindah berlaku SEKARANG s/d jam selesai booking lama (tak reset jam,
 * tak ada waktu gratis). Tamu tak memilih jam saat aktif.
 */
export async function requestMoveTable(input: z.infer<typeof requestSchema>) {
  const profile = await requireProfile();
  const data = requestSchema.parse(input);

  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
      fromLabel: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, data.sessionId));
  if (!session) throw new Error("Session not found");
  if (session.hostId !== profile.id)
    throw new Error("Only the host can request a table move");
  if (session.status !== "open" && session.status !== "locked")
    throw new Error("Table move requests are only allowed while the table is active");
  if (!session.reservationAt || !session.reservationEndAt)
    throw new Error("This session has no time range");

  const [pendingExisting] = await db
    .select({ id: tableMoveRequests.id })
    .from(tableMoveRequests)
    .where(
      and(
        eq(tableMoveRequests.sessionId, session.id),
        eq(tableMoveRequests.status, "pending")
      )
    );
  if (pendingExisting) throw new Error("There's already a pending move request");
  if (session.tableId === data.targetTableId)
    throw new Error("Destination table is the same as the current one");

  const [target] = await db
    .select({
      id: tables.id,
      label: tables.label,
      minSpend: tables.minSpend,
      barId: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, data.targetTableId));
  if (!target || target.barId !== session.barId)
    throw new Error("Invalid destination table");

  // Min-spend: enforce server-side. Kalau meja tujuan ber-min-spend & order
  // sekarang belum cukup → tolak (client harus lewat requestMoveTableWithOrder).
  const minSpend = target.minSpend ?? 0;
  if (minSpend > 0) {
    const [existing] = await db
      .select({
        total: sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(eq(orders.sessionId, session.id), ne(orderItems.status, "void"))
      );
    if (Number(existing?.total ?? 0) < minSpend) {
      throw new Error(
        `Table ${target.label} has a minimum spend. Add an order before requesting the move.`
      );
    }
  }

  // Pertahankan JAM BOOKING ASLI (tak reset, tak pakai sisa). Pindah hanya ganti
  // meja; rentang waktu ikut apa adanya supaya jadwal meja lama tak jadi "kosong"
  // & tak ada celah waktu gratis. Tolak kalau waktu sudah habis.
  const newStart = session.reservationAt;
  const newEnd = session.reservationEndAt;
  if (Date.now() >= newEnd.getTime())
    throw new Error("Booking time is over — can't move");

  const [inserted] = await db
    .insert(tableMoveRequests)
    .values({
      sessionId: session.id,
      requestedBy: profile.id,
      fromTableId: session.tableId,
      toTableId: data.targetTableId,
      reservationAt: newStart,
      reservationEndAt: newEnd,
      status: "pending",
    })
    .returning({ id: tableMoveRequests.id });

  // Notif ke semua staff bar (in-app + push) + channel staff realtime.
  const staff = await db
    .selectDistinct({ profileId: staffRoles.profileId })
    .from(staffRoles)
    .where(
      and(eq(staffRoles.barId, session.barId), eq(staffRoles.isActive, true))
    );
  await Promise.allSettled(
    staff.map((s) =>
      createNotification({
        profileId: s.profileId,
        type: "move_request",
        title: "Request pindah meja",
        body: `${profile.displayName} minta pindah dari meja ${session.fromLabel} ke ${target.label}.`,
        link: "/staff/waiter",
      })
    )
  );
  await Promise.allSettled([
    notify(channels.staff(session.barId)),
    notify(channels.session(session.id)),
  ]);

  revalidatePath(`/session/${session.id}`);
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");
  return { requestId: inserted.id };
}

const requestWithOrderSchema = z.object({
  sessionId: z.string().uuid(),
  targetTableId: z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1),
  paymentMethod: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
});

/**
 * Request pindah (aktif) ke meja ber-min-spend: tambah order + bayar selisih
 * DULU (di sesi sekarang), lalu buat request pending. Pindah dieksekusi saat
 * staff approve.
 */
export async function requestMoveTableWithOrder(
  input: z.infer<typeof requestWithOrderSchema>
) {
  const profile = await requireProfile();
  const data = requestWithOrderSchema.parse(input);

  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
      fromLabel: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, data.sessionId));
  if (!session) throw new Error("Session not found");
  if (session.hostId !== profile.id)
    throw new Error("Only the host can request a table move");
  if (session.status !== "open" && session.status !== "locked")
    throw new Error("Table move requests are only allowed while the table is active");
  if (!session.reservationAt || !session.reservationEndAt)
    throw new Error("This session has no time range");

  const [pendingExisting] = await db
    .select({ id: tableMoveRequests.id })
    .from(tableMoveRequests)
    .where(
      and(
        eq(tableMoveRequests.sessionId, session.id),
        eq(tableMoveRequests.status, "pending")
      )
    );
  if (pendingExisting) throw new Error("There's already a pending move request");

  const [target] = await db
    .select({
      id: tables.id,
      label: tables.label,
      minSpend: tables.minSpend,
      barId: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, data.targetTableId));
  if (!target || target.barId !== session.barId)
    throw new Error("Invalid destination table");
  if (session.tableId === data.targetTableId)
    throw new Error("Destination table is the same as the current one");
  const minSpend = target.minSpend ?? 0;

  // Resolve harga item dari DB.
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

  // Total existing.
  const [existing] = await db
    .select({
      total: sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.sessionId, session.id), ne(orderItems.status, "void")));
  const existingTotal = Number(existing?.total ?? 0);
  if (existingTotal + addedTotal < minSpend) {
    throw new Error(
      `Minimum spend for table ${target.label} not reached. Add more orders.`
    );
  }

  // Pertahankan JAM BOOKING ASLI (tak reset). Lihat catatan di requestMoveTable.
  const newStart = session.reservationAt;
  const newEnd = session.reservationEndAt;
  if (Date.now() >= newEnd.getTime())
    throw new Error("Booking time is over — can't move");

  // Order + payment + request pending (atomik). Pindah dieksekusi saat approve.
  const tx = await db.transaction(async (tx) => {
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

    const [reqRow] = await tx
      .insert(tableMoveRequests)
      .values({
        sessionId: session.id,
        requestedBy: profile.id,
        fromTableId: session.tableId,
        toTableId: data.targetTableId,
        reservationAt: newStart,
        reservationEndAt: newEnd,
        status: "pending",
      })
      .returning({ id: tableMoveRequests.id });
    return { payId: pay.id, requestId: reqRow.id };
  });
  const paymentId: string | null = tx.payId;

  // Charge gateway (best-effort).
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
      /* request tetap dibuat; pembayaran bisa dikonfirmasi manual */
    }
  }

  // Notif staff.
  const staff = await db
    .selectDistinct({ profileId: staffRoles.profileId })
    .from(staffRoles)
    .where(
      and(eq(staffRoles.barId, session.barId), eq(staffRoles.isActive, true))
    );
  await Promise.allSettled(
    staff.map((s) =>
      createNotification({
        profileId: s.profileId,
        type: "move_request",
        title: "Request pindah meja",
        body: `${profile.displayName} minta pindah dari meja ${session.fromLabel} ke ${target.label}.`,
        link: "/staff/waiter",
      })
    )
  );
  await Promise.allSettled([
    notify(channels.staff(session.barId)),
    notify(channels.session(session.id)),
  ]);

  revalidatePath(`/session/${session.id}`);
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");
  return { requestId: tx.requestId };
}

/** Request pindah pending milik sesi (badge status di UI customer). */
export async function getMyPendingMove(
  sessionId: string
): Promise<{ id: string; toLabel: string; reservationAt: string } | null> {
  const [row] = await db
    .select({
      id: tableMoveRequests.id,
      toLabel: tables.label,
      reservationAt: tableMoveRequests.reservationAt,
    })
    .from(tableMoveRequests)
    .innerJoin(tables, eq(tables.id, tableMoveRequests.toTableId))
    .where(
      and(
        eq(tableMoveRequests.sessionId, sessionId),
        eq(tableMoveRequests.status, "pending")
      )
    )
    .limit(1);
  return row
    ? {
        id: row.id,
        toLabel: row.toLabel,
        reservationAt: row.reservationAt.toISOString(),
      }
    : null;
}

/**
 * Host membatalkan request pindah miliknya yang masih pending. Hanya host sesi
 * & hanya kalau status masih pending. Notif staff supaya panel mereka update.
 */
export async function cancelMyMoveRequest(requestId: string) {
  const profile = await requireProfile();

  const [req] = await db
    .select({
      id: tableMoveRequests.id,
      sessionId: tableMoveRequests.sessionId,
      status: tableMoveRequests.status,
      requestedBy: tableMoveRequests.requestedBy,
      hostId: tableSessions.hostId,
      barId: floorAreas.barId,
    })
    .from(tableMoveRequests)
    .innerJoin(tableSessions, eq(tableSessions.id, tableMoveRequests.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableMoveRequests.id, requestId));
  if (!req) throw new Error("Request not found");
  if (req.hostId !== profile.id)
    throw new Error("Only the host can cancel this request");
  if (req.status !== "pending")
    throw new Error("Request already processed");

  await db
    .update(tableMoveRequests)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(eq(tableMoveRequests.id, requestId));

  await Promise.allSettled([
    notify(channels.session(req.sessionId)),
    notify(channels.staff(req.barId)),
  ]);
  revalidatePath(`/session/${req.sessionId}`);
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");
}

export interface MoveRequestRow {
  id: string;
  requester_name: string;
  from_label: string;
  to_label: string;
  reservation_at: string;
  reservation_end_at: string;
  status: string;
  created_at: string;
}

/**
 * Daftar request pindah utk staff dashboard — SEMUA status (pending dulu, lalu
 * yg sudah diproses), terbaru. Pending tetap bisa di-approve/tolak; yg sudah
 * resolved tetap tampil sbg riwayat.
 */
export async function getMoveRequests(): Promise<MoveRequestRow[]> {
  const ctx = await requirePermission(
    "open_table_for_customer",
    "/staff/waiter"
  );
  const ft = alias(tables, "ft");
  const tt = alias(tables, "tt");
  const rows = await db
    .select({
      id: tableMoveRequests.id,
      requester_name: profiles.displayName,
      from_label: ft.label,
      to_label: tt.label,
      reservation_at: tableMoveRequests.reservationAt,
      reservation_end_at: tableMoveRequests.reservationEndAt,
      status: tableMoveRequests.status,
      created_at: tableMoveRequests.createdAt,
    })
    .from(tableMoveRequests)
    .innerJoin(profiles, eq(profiles.id, tableMoveRequests.requestedBy))
    .innerJoin(ft, eq(ft.id, tableMoveRequests.fromTableId))
    .innerJoin(tt, eq(tt.id, tableMoveRequests.toTableId))
    .innerJoin(floorAreas, eq(floorAreas.id, ft.areaId))
    .where(eq(floorAreas.barId, ctx.barId))
    // pending paling atas, lalu terbaru.
    .orderBy(
      sql`case when ${tableMoveRequests.status} = 'pending' then 0 else 1 end`,
      desc(tableMoveRequests.createdAt)
    )
    .limit(30);
  return rows.map((r) => ({
    id: r.id,
    requester_name: r.requester_name,
    from_label: r.from_label,
    to_label: r.to_label,
    reservation_at: r.reservation_at.toISOString(),
    reservation_end_at: r.reservation_end_at.toISOString(),
    status: r.status,
    created_at: r.created_at.toISOString(),
  }));
}

/** Staff approve/reject request. Approve → eksekusi pindah (cek slot ulang). */
export async function resolveMoveRequest(input: {
  requestId: string;
  approve: boolean;
}) {
  const ctx = await requirePermission(
    "open_table_for_customer",
    "/staff/waiter"
  );

  const [req] = await db
    .select()
    .from(tableMoveRequests)
    .where(eq(tableMoveRequests.id, input.requestId));
  if (!req) throw new Error("Request not found");
  if (req.status !== "pending") throw new Error("Request already processed");

  const [session] = await db
    .select({
      id: tableSessions.id,
      hostId: tableSessions.hostId,
      barId: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, req.sessionId));
  const [toTable] = await db
    .select({ label: tables.label })
    .from(tables)
    .where(eq(tables.id, req.toTableId));
  const toLabel = toTable?.label ?? "meja baru";

  if (!input.approve) {
    await db
      .update(tableMoveRequests)
      .set({
        status: "rejected",
        resolvedBy: ctx.profileId,
        resolvedAt: new Date(),
      })
      .where(eq(tableMoveRequests.id, req.id));
    if (session) {
      await createNotification({
        profileId: session.hostId,
        type: "move_rejected",
        title: "Request pindah ditolak",
        body: `Maaf, request pindah ke meja ${toLabel} ditolak.`,
        link: `/session/${session.id}`,
      });
      await Promise.allSettled([
        notify(channels.session(session.id)),
        notify(channels.staff(session.barId)),
      ]);
    }
    revalidatePath("/staff/waiter");
    revalidatePath("/staff/cashier");
    return;
  }

  // Approve → eksekusi pindah (constraint DB cek slot ulang).
  try {
    await db
      .update(tableSessions)
      .set({
        tableId: req.toTableId,
        reservationAt: req.reservationAt,
        reservationEndAt: req.reservationEndAt,
      })
      .where(eq(tableSessions.id, req.sessionId));
  } catch (err) {
    if (
      isDbConstraintError(err, "no_overlapping_reservation") ||
      isDbConstraintError(err, "uq_active_session_per_table")
    ) {
      await db
        .update(tableMoveRequests)
        .set({
          status: "rejected",
          resolvedBy: ctx.profileId,
          resolvedAt: new Date(),
        })
        .where(eq(tableMoveRequests.id, req.id));
      if (session) {
        await createNotification({
          profileId: session.hostId,
          type: "move_rejected",
          title: "Pindah meja gagal",
          body: `Meja ${toLabel} keburu terisi. Request dibatalkan.`,
          link: `/session/${session.id}`,
        });
      }
      throw new Error(
        `Table ${toLabel} was taken — request auto-rejected.`
      );
    }
    throw err;
  }

  await db
    .update(tableMoveRequests)
    .set({
      status: "approved",
      resolvedBy: ctx.profileId,
      resolvedAt: new Date(),
    })
    .where(eq(tableMoveRequests.id, req.id));

  if (session) {
    await createNotification({
      profileId: session.hostId,
      type: "move_approved",
      title: "Pindah meja disetujui",
      body: `Kamu sudah dipindah ke meja ${toLabel}.`,
      link: `/session/${session.id}`,
    });
    await Promise.allSettled([
      notify(channels.session(session.id)),
      notify(channels.bar(session.barId)),
      notify(channels.staff(session.barId)),
    ]);
  }
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");
}

// ============================================================
// STAFF — PINDAH LANGSUNG (tanpa approval, ada audit)
// ============================================================

const staffMoveSchema = z.object({
  sessionId: z.string().uuid(),
  targetTableId: z.string().uuid(),
});

/**
 * Staff (kasir/waiter/manager/admin) memindahkan meja LANGSUNG tanpa approval.
 * Jam booking dipertahankan apa adanya (tak reset). Tercatat di
 * table_move_requests status 'approved' + resolvedBy = staff (audit). Host
 * dapat notif.
 */
export async function staffMoveTable(input: z.infer<typeof staffMoveSchema>) {
  const ctx = await requirePermission("open_table_for_customer", "/staff/waiter");
  const data = staffMoveSchema.parse(input);

  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
      fromLabel: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, data.sessionId));
  if (!session) throw new Error("Session not found");
  if (session.barId !== ctx.barId) throw new Error("Session outside your bar");
  if (
    session.status !== "reserved" &&
    session.status !== "open" &&
    session.status !== "locked"
  )
    throw new Error("Only active/booking sessions can be moved");
  if (!session.reservationAt || !session.reservationEndAt)
    throw new Error("This session has no time range");

  const [target] = await db
    .select({ id: tables.id, label: tables.label, barId: floorAreas.barId })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, data.targetTableId));
  if (!target || target.barId !== session.barId)
    throw new Error("Invalid destination table");
  if (session.tableId === data.targetTableId)
    throw new Error("Destination table is the same as the current one");

  // Jam booking dipertahankan apa adanya.
  const newStart = session.reservationAt;
  const newEnd = session.reservationEndAt;

  try {
    await db
      .update(tableSessions)
      .set({ tableId: data.targetTableId })
      .where(eq(tableSessions.id, session.id));
  } catch (err) {
    if (
      isDbConstraintError(err, "no_overlapping_reservation") ||
      isDbConstraintError(err, "uq_active_session_per_table")
    ) {
      throw new Error(`Table ${target.label} conflicts at this booking time`);
    }
    throw err;
  }

  // Audit: catat sbg request approved oleh staff.
  await db.insert(tableMoveRequests).values({
    sessionId: session.id,
    requestedBy: session.hostId,
    fromTableId: session.tableId,
    toTableId: data.targetTableId,
    reservationAt: newStart,
    reservationEndAt: newEnd,
    status: "approved",
    resolvedBy: ctx.profileId,
    resolvedAt: new Date(),
  });

  // Notif host.
  await createNotification({
    profileId: session.hostId,
    type: "move_approved",
    title: "Meja kamu dipindah",
    body: `Staff memindahkan kamu dari meja ${session.fromLabel} ke ${target.label}.`,
    link: `/session/${session.id}`,
  });
  await Promise.allSettled([
    notify(channels.session(session.id)),
    notify(channels.bar(session.barId)),
    notify(channels.staff(session.barId)),
  ]);

  revalidatePath(`/session/${session.id}`);
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");
}
