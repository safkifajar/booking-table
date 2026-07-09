import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments } from "@/lib/db/schema/orders";
import { orders } from "@/lib/db/schema/orders";
import { tableSessions } from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { getCurrentProfile, getStaffRole } from "@/lib/auth-v2/current";
import { expireDpIfOverdue } from "@/lib/queries";
import { BookingPayView } from "./BookingPayView";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Sisa detik sampai QR expired (min 0). Dipisah dari komponen supaya
 * Date.now() tak melanggar aturan purity render React. */
function secondsUntil(expiresMs: number): number {
  return Math.max(0, Math.round((expiresMs - Date.now()) / 1000));
}

/**
 * Halaman khusus melanjutkan pembayaran DP booking (QRIS) — dibuka saat host
 * kembali ke booking yg DP-nya masih pending. Tampilkan QR + countdown; sampai
 * lunas, host TIDAK bisa ke halaman detail (guard di /session/[id]).
 */
export default async function BookingPayPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/booking/${id}/pay`)}`);
  }

  // Batalkan dulu kalau sudah lewat batas (jaring pengaman selain countdown).
  await expireDpIfOverdue(id);

  const [row] = await db
    .select({
      session_id: tableSessions.id,
      status: tableSessions.status,
      host_id: tableSessions.hostId,
      dp_paid_at: tableSessions.dpPaidAt,
      bar_id: bars.id,
      bar_slug: bars.slug,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tableSessions.id, id));

  if (!row) notFound();

  const staffRole = (await getStaffRole())?.role ?? null;

  // Kalau DP sudah lunas / booking bukan reserved lagi → tak ada yg dibayar,
  // arahkan ke detail (kalau berhak) atau denah.
  if (row.status !== "reserved" || row.dp_paid_at != null) {
    redirect(`/session/${id}`);
  }

  // Ambil DP payment pending untuk sesi ini.
  const [dp] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      status: payments.status,
      split_meta: payments.splitMeta,
      created_at: payments.createdAt,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(orders.sessionId, id),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
      )
    )
    .limit(1);

  // Tidak ada DP pending → tidak perlu halaman ini.
  if (!dp) {
    redirect(staffRole ? `/session/${id}` : `/bar/${row.bar_slug}`);
  }

  const meta = (dp.split_meta ?? {}) as {
    qrString?: string | null;
    expiresAt?: string | null;
  };
  if (!meta.qrString) {
    // DP pending tapi tak ada QR (mis. gateway gagal) → serahkan ke detail.
    redirect(`/session/${id}`);
  }

  // Sisa detik: dari expiresAt kalau ada, kalau tidak dari created_at + 60s.
  const DP_TIMEOUT_MS = 60 * 1000;
  const expiresMs = meta.expiresAt
    ? new Date(meta.expiresAt).getTime()
    : dp.created_at.getTime() + DP_TIMEOUT_MS;
  const secondsLeft = secondsUntil(expiresMs);

  return (
    <BookingPayView
      paymentId={dp.id}
      qrString={meta.qrString}
      amount={dp.amount}
      secondsLeft={secondsLeft}
      sessionId={id}
      barSlug={row.bar_slug}
    />
  );
}
