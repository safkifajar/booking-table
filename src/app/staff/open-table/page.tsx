import { requireAnyRole } from "@/lib/auth-v2/permissions";
import {
  getReservationDataForWaiter,
} from "@/lib/waiter-actions";
import {
  getFloorMapForBar,
  expireFinishedSessions,
  promoteDueReservations,
} from "@/lib/queries";
import { OpenTableForm } from "@/components/staff/OpenTableForm";

// Denah + reservasi berbasis waktu → selalu dinamis.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string }>;
}

/**
 * Halaman "Open Table for Guest" (walk-in) — dibuka dari dashboard waiter/kasir.
 * Sebelumnya bottom sheet; dipindah ke halaman penuh supaya denah lantai punya
 * ruang. `?from=` menentukan tombol Back kembali ke dashboard asal.
 */
export default async function StaffOpenTablePage({ searchParams }: PageProps) {
  const ctx = await requireAnyRole(
    ["waiter", "cashier", "manager", "admin"],
    "/staff/open-table"
  );
  const { from } = await searchParams;
  // Hanya izinkan tujuan internal staff (cegah open-redirect via ?from=).
  const backHref = from === "cashier" ? "/staff/cashier" : "/staff/waiter";

  // Transisi status berbasis waktu (lazy) sebelum ambil denah, supaya meja yg
  // reservasinya tiba / selesai tampil dengan status benar.
  await expireFinishedSessions(ctx.barId);
  await promoteDueReservations(ctx.barId);

  const [floorMap, reservationData] = await Promise.all([
    getFloorMapForBar(ctx.barId),
    getReservationDataForWaiter(),
  ]);

  return (
    <OpenTableForm
      floorMap={floorMap}
      reservationData={reservationData}
      backHref={backHref}
    />
  );
}
