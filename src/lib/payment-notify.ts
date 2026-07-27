import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments, orders } from "@/lib/db/schema/orders";
import { tableSessions } from "@/lib/db/schema/sessions";
import { sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { staffRoles } from "@/lib/db/schema/extras";
import { createNotification } from "@/lib/notifications";
import { formatIDR } from "@/lib/utils";

type PaymentEvent = "paid" | "dp_confirmed" | "cancelled";

/**
 * Kirim notifikasi pembayaran (in-app + web push via createNotification) ke:
 * host meja, pembayar, dan semua staff aktif di bar. Best-effort — tak
 * menggagalkan alur pembayaran kalau notif gagal. Idempotency ditangani
 * pemanggil (mis. markPaymentPaidBySystem cuma jalan sekali saat transisi).
 */
export async function notifyPaymentEvent(
  paymentId: string,
  event: PaymentEvent
): Promise<void> {
  try {
    const [row] = await db
      .select({
        amount: payments.amount,
        sessionId: orders.sessionId,
        hostId: tableSessions.hostId,
        payerProfileId: sessionMembers.profileId,
        tableLabel: tables.label,
        barId: floorAreas.barId,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
      .leftJoin(
        sessionMembers,
        eq(sessionMembers.id, payments.paidByMemberId)
      )
      .where(eq(payments.id, paymentId));
    if (!row) return;

    const label = row.tableLabel ?? "table";
    const link = `/session/${row.sessionId}`;
    const amount = formatIDR(row.amount);

    let title: string;
    let body: string;
    let type: "payment_received" | "payment_cancelled";
    if (event === "dp_confirmed") {
      type = "payment_received";
      title = "Booking confirmed";
      body = `Down payment of ${amount} for table ${label} received. Your booking is confirmed.`;
    } else if (event === "paid") {
      type = "payment_received";
      title = "Payment received";
      body = `Payment of ${amount} for table ${label} was received successfully.`;
    } else {
      type = "payment_cancelled";
      title = "Payment failed";
      body = `Payment of ${amount} for table ${label} expired or was cancelled.`;
    }

    // Penerima: host + pembayar (dedup) + staff aktif bar.
    const recipients = new Set<string>();
    if (row.hostId) recipients.add(row.hostId);
    if (row.payerProfileId) recipients.add(row.payerProfileId);

    const staff = await db
      .select({ profileId: staffRoles.profileId })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.barId, row.barId), eq(staffRoles.isActive, true))
      );
    for (const s of staff) recipients.add(s.profileId);

    await Promise.allSettled(
      Array.from(recipients).map((profileId) =>
        createNotification({ profileId, type, title, body, link })
      )
    );
  } catch {
    // best-effort — jangan ganggu alur pembayaran.
  }
}

/**
 * Beri tahu KASIR (role cashier/manager/admin aktif di bar) bahwa ada customer
 * yang memilih "Pay at cashier" — mereka perlu siap menerima uang & konfirmasi.
 * Dipanggil saat payment pending pay-at-cashier dibuat (bill maupun DP booking).
 * Best-effort; tak menggagalkan alur pembayaran.
 */
export async function notifyCashiersPayAtCashier(input: {
  paymentId: string;
  isDownPayment: boolean;
}): Promise<void> {
  try {
    const [row] = await db
      .select({
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
      .where(eq(payments.id, input.paymentId));
    if (!row) return;

    const label = row.tableLabel ?? "table";
    const amount = formatIDR(row.amount);
    const kind = input.isDownPayment ? "Deposit" : "Bill";
    const title = "Pay at cashier";
    const body = `${kind} ${amount} for table ${label}. Customer will pay at the cashier. Confirm once received.`;
    const link = `/session/${row.sessionId}`;

    // Hanya staff yang boleh menerima pembayaran: cashier/manager/admin.
    const staff = await db
      .select({ profileId: staffRoles.profileId })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.barId, row.barId),
          eq(staffRoles.isActive, true),
          inArray(staffRoles.role, ["cashier", "manager", "admin"])
        )
      );

    await Promise.allSettled(
      staff.map((s) =>
        createNotification({
          profileId: s.profileId,
          type: "general",
          title,
          body,
          link,
        })
      )
    );
  } catch {
    // best-effort.
  }
}
