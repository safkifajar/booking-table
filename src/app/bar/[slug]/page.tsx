import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getBarBySlug, getFloorAreas, getTablesByArea, getActiveSessionsForArea, promoteDueReservations } from "@/lib/queries";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";
import { BarFloorView } from "./BarFloorView";
import { UserMenu } from "@/components/UserMenu";
import type { FloorMapTable } from "@/components/floor/FloorMap";
import type { ActiveSessionView } from "@/types/db";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BarPage({ params }: PageProps) {
  const { slug } = await params;
  const bar = await getBarBySlug(slug);
  if (!bar) notFound();

  // Promote reservasi yg waktunya sudah tiba → open (lazy, tiap floor di-load).
  await promoteDueReservations(bar.id);

  const areas = await getFloorAreas(bar.id);

  // Settings bar (jam operasi + slot interval) untuk generate list jam di
  // bottom sheet floor view.
  const [barSettings] = await db
    .select({
      opening_hours: bars.openingHours,
      reservation_config: bars.reservationConfig,
    })
    .from(bars)
    .where(eq(bars.id, bar.id));
  const operatingHours: OperatingHours = {
    ...DEFAULT_OPERATING_HOURS,
    ...((barSettings?.opening_hours as OperatingHours) ?? {}),
  };
  const reservationConfig: ReservationConfig = {
    ...DEFAULT_RESERVATION_CONFIG,
    ...((barSettings?.reservation_config as Partial<ReservationConfig>) ?? {}),
  };

  // Map tableId → semua reservasi 'reserved' (urut by jam mulai). Satu meja
  // bisa punya banyak reservasi di slot berbeda — bottom sheet tampilkan semua.
  const reservationsByTable: Record<string, ActiveSessionView[]> = {};

  const areasWithTables = await Promise.all(
    areas.map(async (area) => {
      const [tables, sessions] = await Promise.all([
        getTablesByArea(area.id),
        getActiveSessionsForArea(area.id),
      ]);
      const tablesWithSession: FloorMapTable[] = tables.map((t) => {
        const forTable = sessions.filter((s) => s.table_id === t.id);
        const reservations = forTable
          .filter((s) => s.status === "reserved")
          .sort((a, b) =>
            (a.reservation_at ?? "").localeCompare(b.reservation_at ?? "")
          );
        if (reservations.length > 0) {
          reservationsByTable[t.id] = reservations;
        }
        // active_session untuk denah: prioritaskan session open/locked (meja
        // sedang dipakai), kalau tidak ada pakai reservasi terdekat berikutnya.
        const active =
          forTable.find((s) => s.status === "open" || s.status === "locked") ??
          reservations[0] ??
          null;
        return { ...t, active_session: active };
      });
      return { area, tables: tablesWithSession };
    })
  );

  return (
    <BarFloorView
      bar={bar}
      areasWithTables={areasWithTables}
      reservationsByTable={reservationsByTable}
      operatingHours={operatingHours}
      slotIntervalMinutes={reservationConfig.slotIntervalMinutes}
      bookingWindowDays={reservationConfig.bookingWindowDays}
      userMenu={<UserMenu />}
    />
  );
}
