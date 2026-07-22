import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments, orders } from "@/lib/db/schema/orders";
import { tableSessions } from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { expireOverduePayAtCashierOrders } from "@/lib/queries";
import { OrderCashierWaitView } from "./OrderCashierWaitView";

interface PageProps {
  params: Promise<{ id: string; orderId: string }>;
}

/** Sisa detik sampai batas konfirmasi (min 0). Dipisah dari komponen supaya
 *  Date.now() tak melanggar purity render. */
function secondsUntil(expiresMs: number): number {
  return Math.max(0, Math.round((expiresMs - Date.now()) / 1000));
}

/**
 * Halaman tunggu "Pay at the cashier" untuk ORDER MEJA AKTIF (bukan DP booking).
 * Setelah customer memilih bayar tunai di kasir untuk order tambahan, diarahkan
 * ke sini: instruksi + countdown 10 menit + poll. Kasir konfirmasi → order
 * masuk & halaman refresh ke order detail. Waktu habis → order dibatalkan
 * (item void), MEJA tetap terbuka.
 *
 * Beda dari /booking/[id]/pay (khusus DP booking, sesi 'reserved'): ini untuk
 * sesi 'open'/'locked' + payment pay-at-cashier NON-DP.
 */
export default async function OrderPayPage({ params }: PageProps) {
  const { id, orderId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(
      `/auth?next=${encodeURIComponent(`/session/${id}/order/${orderId}/pay`)}`
    );
  }

  // Ambil bar dulu (untuk sweep + slug) via order → sesi → meja → bar.
  const [ctx] = await db
    .select({
      bar_id: bars.id,
      bar_slug: bars.slug,
      table_label: tables.label,
      session_status: tableSessions.status,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(and(eq(orders.id, orderId), eq(orders.sessionId, id)));
  if (!ctx) notFound();

  // Sweep dulu (jaring pengaman selain countdown) — order basi dibatalkan.
  await expireOverduePayAtCashierOrders(ctx.bar_id).catch(() => {});

  // Cari payment pending pay-at-cashier NON-DP untuk order ini.
  const [pay] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      status: payments.status,
      split_meta: payments.splitMeta,
      created_at: payments.createdAt,
    })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`,
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS NOT TRUE`
      )
    )
    .limit(1);

  // Tak ada pending pay-at-cashier lagi (sudah dibayar/dibatalkan/expired) →
  // balik ke detail order.
  if (!pay) {
    redirect(`/session/${id}/order/${orderId}`);
  }

  const meta = (pay.split_meta ?? {}) as { expiresAt?: string | null };
  const PAY_AT_CASHIER_MS = 10 * 60 * 1000;
  const expiresMs = meta.expiresAt
    ? new Date(meta.expiresAt).getTime()
    : pay.created_at.getTime() + PAY_AT_CASHIER_MS;

  return (
    <OrderCashierWaitView
      paymentId={pay.id}
      amount={pay.amount}
      secondsLeft={secondsUntil(expiresMs)}
      sessionId={id}
      orderId={orderId}
      tableLabel={ctx.table_label}
    />
  );
}
