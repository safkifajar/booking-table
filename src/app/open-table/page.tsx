import { Suspense } from "react";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { tableSessions } from "@/lib/db/schema/sessions";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { getMenuByBar, flattenMenuTree } from "@/lib/queries";
import {
  DEFAULT_CHARGE_CONFIG,
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  type ChargeConfig,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";
import {
  generateAvailableSlots,
  getBookedSlotIsos,
  type BookedRange,
} from "@/lib/reservation-helpers";
import { OpenTableForm } from "./OpenTableForm";

interface PageProps {
  searchParams: Promise<{ tableId?: string; start?: string; end?: string }>;
}

export default async function OpenTablePage({ searchParams }: PageProps) {
  const { tableId, start, end } = await searchParams;
  if (!tableId) redirect("/");

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth?next=${encodeURIComponent(`/open-table?tableId=${tableId}`)}`);
  }
  const profile = await getCurrentProfile();
  if (profile && !profile.onboarded) {
    redirect(
      `/onboarding?next=${encodeURIComponent(`/open-table?tableId=${tableId}`)}`
    );
  }

  // Single join: table → area → bar (+ settings)
  const [row] = await db
    .select({
      table_id: tables.id,
      label: tables.label,
      shape: tables.shape,
      capacity: tables.capacity,
      min_spend: tables.minSpend,
      area_name: floorAreas.name,
      bar_id: bars.id,
      bar_name: bars.name,
      bar_slug: bars.slug,
      opening_hours: bars.openingHours,
      reservation_config: bars.reservationConfig,
      charge_config: bars.chargeConfig,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tables.id, tableId));

  if (!row) redirect("/");

  // Merge settings dengan defaults
  const opHours: OperatingHours = {
    ...DEFAULT_OPERATING_HOURS,
    ...((row.opening_hours as OperatingHours) ?? {}),
  };
  const resConfig: ReservationConfig = {
    ...DEFAULT_RESERVATION_CONFIG,
    ...((row.reservation_config as Partial<ReservationConfig>) ?? {}),
  };
  // Tax & service — dipakai form utk hitung grand total (basis DP).
  const chargeCfg: ChargeConfig = {
    ...DEFAULT_CHARGE_CONFIG,
    ...((row.charge_config as Partial<ChargeConfig>) ?? {}),
  };

  // Generate available slots untuk reservasi (kalau enabled)
  const now = new Date();
  const slots = resConfig.enabled
    ? generateAvailableSlots(now, resConfig, opHours)
    : [];

  // Reservasi existing di meja ini → tandai slot yang sudah ke-booking
  let bookedSlotIsos: string[] = [];
  if (resConfig.enabled && slots.length > 0) {
    const existingRows = await db
      .select({
        startAt: tableSessions.reservationAt,
        endAt: tableSessions.reservationEndAt,
      })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tableId, row.table_id),
          // Hanya status yg BENAR-BENAR menempati slot: reserved (booking blm
          // mulai) + open/locked (sedang dipakai). 'overdue' DIKECUALIKAN —
          // meja sudah ditutup (booking selesai, sisa hutang ditagih terpisah),
          // jadi slot-nya bebas dipesan lagi. Konsisten dgn migration 0028
          // (overdue bukan okupansi) & overlap-check di openTable.
          inArray(tableSessions.status, ["reserved", "open", "locked"])
        )
      );
    const existing: BookedRange[] = existingRows
      .filter((r) => r.startAt && r.endAt && r.endAt.getTime() > now.getTime())
      .map((r) => ({
        startMs: r.startAt!.getTime(),
        endMs: r.endAt!.getTime(),
      }));
    bookedSlotIsos = Array.from(getBookedSlotIsos(slots, existing));
  }

  // Menu untuk picker (kalau perlu order awal — min spend / reservation).
  // Flat: tiap entri = sub-kategori (+ parent_name utk heading 2 tingkat).
  const needsMenu = (row.min_spend ?? 0) > 0 || resConfig.enabled;
  const menu = needsMenu
    ? flattenMenuTree(await getMenuByBar(row.bar_id))
    : [];

  // items-center DILEPAS dari pembungkus: header form di dalamnya sticky, dan
  // pemusatan vertikal membuat pembungkusnya lebih pendek dari konten sehingga
  // sticky tak punya ruang untuk menempel.
  return (
    <main className="flex-1 flex justify-center px-4 pb-8">
      <Suspense>
        <OpenTableForm
          table={{
            id: row.table_id,
            label: row.label,
            shape: row.shape,
            capacity: row.capacity,
            min_spend: row.min_spend ?? 0,
          }}
          areaName={row.area_name}
          barName={row.bar_name}
          barSlug={row.bar_slug}
          reservationConfig={resConfig}
          chargeConfig={chargeCfg}
          slots={slots}
          bookedSlotIsos={bookedSlotIsos}
          initialStart={start}
          initialEnd={end}
          menu={menu.map((c) => ({
            id: c.id,
            name: c.name,
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
              })),
          }))}
        />
      </Suspense>
    </main>
  );
}
