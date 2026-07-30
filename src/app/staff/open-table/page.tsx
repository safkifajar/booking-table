import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { getChargeConfig } from "@/lib/settings-actions";
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
import { getCustomerAsTableHost } from "@/lib/staff-customer-actions";

// Denah + reservasi berbasis waktu → selalu dinamis.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string; customer?: string }>;
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
  const { from, customer } = await searchParams;
  // Hanya izinkan tujuan internal staff (cegah open-redirect via ?from=).
  const backHref =
    from === "customers"
      ? "/staff/cashier/customers"
      : from === "cashier"
        ? "/staff/cashier"
        : "/staff/waiter";

  // ?customer=<uuid> → buka meja atas nama AKUN pelanggan (dipilih dari menu
  // Customers di kasir). Divalidasi di sini supaya form hanya menerima akun
  // pelanggan asli (bukan guest walk-in / staff / akun nonaktif).
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      customer ?? ""
    );
  const hostCustomer = isUuid
    ? await getCustomerAsTableHost(customer as string)
    : null;

  // Transisi status berbasis waktu (lazy) sebelum ambil denah, supaya meja yg
  // reservasinya tiba / selesai tampil dengan status benar.
  await expireFinishedSessions(ctx.barId);
  await promoteDueReservations(ctx.barId);

  const [floorMap, reservationData, menuTree, chargeConfig] = await Promise.all([
    getFloorMapForBar(ctx.barId),
    getReservationDataForWaiter(),
    getMenuByBar(ctx.barId),
    getChargeConfig(ctx.barId),
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
      chargeConfig={chargeConfig}
      backHref={backHref}
      hostCustomer={hostCustomer}
    />
  );
}
