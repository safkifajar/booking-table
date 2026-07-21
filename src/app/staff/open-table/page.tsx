import { requireAnyRole } from "@/lib/auth-v2/permissions";
import {
  getReservationDataForWaiter,
} from "@/lib/waiter-actions";
import {
  getFloorMapForBar,
  getMenuByBar,
  flattenMenuTree,
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

  const [floorMap, reservationData, menuTree] = await Promise.all([
    getFloorMapForBar(ctx.barId),
    getReservationDataForWaiter(),
    getMenuByBar(ctx.barId),
  ]);
  const menu = flattenMenuTree(menuTree).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    parent_name: c.parent_name,
    items: c.items
      .filter((i) => i.is_available)
      .map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        image_url: i.image_url,
        tags: i.tags,
        is_available: i.is_available,
        prep_minutes: i.prep_minutes,
      })),
  }));

  return (
    <OpenTableForm
      floorMap={floorMap}
      reservationData={reservationData}
      menu={menu}
      backHref={backHref}
    />
  );
}
