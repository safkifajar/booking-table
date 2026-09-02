import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments, orders } from "@/lib/db/schema/orders";
import { tableSessions } from "@/lib/db/schema/sessions";
import { sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
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
        payerName: profiles.displayName,
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
      .leftJoin(profiles, eq(profiles.id, sessionMembers.profileId))
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

    /**
     * Untuk HOST, sebutkan SIAPA yang membayar. Saat tagihan dibagi ke
     * beberapa anggota, "Payment of Rp X was received" tak memberi tahu
     * apa-apa — host menunggu beberapa orang sekaligus dan perlu tahu
     * siapa yang sudah beres. Pembayarnya sendiri tetap menerima
     * konfirmasi biasa (dia tahu itu dirinya).
     */
    const isSplitShare = row.payerProfileId != null && row.hostId != null &&
      row.payerProfileId !== row.hostId;
    const hostBody =
      event === "paid" && isSplitShare && row.payerName
        ? `${row.payerName} paid their ${amount} share for table ${label}.`
        : body;

    await Promise.allSettled(
      Array.from(recipients).map((profileId) =>
        createNotification({
          profileId,
          type,
          title,
          body: profileId === row.hostId ? hostBody : body,
          link,
        })
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

/**
 * Beri tahu ANGGOTA bahwa host sudah membagi tagihan & QRIS mereka siap
 * dibayar (in-app + web push).
 *
 * Sebelum ini, membuat split hanya menyegarkan layar lewat SSE — anggota yang
 * tak sedang membuka aplikasi tak tahu apa-apa sampai ditagih lisan. Kasir
 * sudah lebih dulu diberi tahu (notifyCashiersPayAtCashier); anggotanya
 * justru terlewat.
 *
 * Nominal ditulis PER ORANG, bukan pesan seragam: yang perlu diketahui
 * anggota adalah berapa bagiannya, dan bagian terakhir bisa berbeda beberapa
 * rupiah karena menyerap sisa pembulatan.
 *
 * HOST TIDAK DIBERI TAHU — dialah yang baru saja menekan tombolnya, dan
 * QRIS-nya sudah terpampang di layarnya sendiri.
 *
 * Best-effort: kegagalan notifikasi tak boleh membatalkan pembayaran yang
 * sudah terbuat.
 */
export async function notifySplitMembers(input: {
  sessionId: string;
  /** Hasil per anggota — hanya yang BERHASIL dibuat yang diberi tahu. */
  members: { memberId: string; amount: number }[];
  /** Order yang ditagihkan — dipakai menautkan langsung ke halaman bayarnya. */
  orderId: string;
}): Promise<void> {
  try {
    if (input.members.length === 0) return;

    const [ctx] = await db
      .select({
        hostId: tableSessions.hostId,
        tableLabel: tables.label,
      })
      .from(tableSessions)
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .where(eq(tableSessions.id, input.sessionId));
    if (!ctx) return;

    // memberId -> profileId. Anggota tamu (walk-in tanpa akun) tak punya
    // perangkat untuk dikirimi, tapi barisnya tetap ada di sessionMembers.
    const rows = await db
      .select({
        memberId: sessionMembers.id,
        profileId: sessionMembers.profileId,
      })
      .from(sessionMembers)
      .where(
        inArray(
          sessionMembers.id,
          input.members.map((m) => m.memberId)
        )
      );
    const profileOf = new Map(rows.map((r) => [r.memberId, r.profileId]));

    const label = ctx.tableLabel ?? "your table";
    const link = `/session/${input.sessionId}/order/${input.orderId}`;

    await Promise.allSettled(
      input.members.map((m) => {
        const profileId = profileOf.get(m.memberId);
        // Host dilewati — lihat catatan di atas.
        if (!profileId || profileId === ctx.hostId) return Promise.resolve();
        return createNotification({
          profileId,
          type: "payment_received",
          title: "Your share is ready to pay",
          body: `The bill for table ${label} was split. Your share is ${formatIDR(
            m.amount
          )} — tap to pay with QRIS.`,
          link,
        });
      })
    );
  } catch {
    // best-effort — jangan ganggu alur pembayaran.
  }
}
