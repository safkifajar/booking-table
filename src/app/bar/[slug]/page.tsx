import { notFound } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";
import { getBarBySlug, getFloorAreas, getTablesByArea, getActiveSessionsForArea, promoteDueReservations, expireFinishedSessions } from "@/lib/queries";
import { db } from "@/lib/db/client";
import { bars, tables, floorAreas } from "@/lib/db/schema/venue";
import { tableSessions } from "@/lib/db/schema/sessions";
import { profiles } from "@/lib/db/schema/profiles";
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";
import { BarFloorView } from "./BarFloorView";
import { HomeBottomNav } from "@/components/HomeBottomNav";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import type { FloorMapTable } from "@/components/floor/FloorMap";
import type { ActiveSessionView } from "@/types/db";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Window history reservasi: dari kemarin sampai N hari ke depan + 'now'. */
function historyWindow(bookingWindowDays: number): {
  start: Date;
  end: Date;
  now: Date;
} {
  const nowMs = Date.now();
  return {
    start: new Date(nowMs - 24 * 60 * 60 * 1000),
    end: new Date(nowMs + bookingWindowDays * 24 * 60 * 60 * 1000),
    now: new Date(nowMs),
  };
}

export default async function BarPage({ params }: PageProps) {
  const { slug } = await params;
  const bar = await getBarBySlug(slug);
  if (!bar) notFound();

  // Lifecycle reservasi (lazy, tiap floor di-load):
  // 1. Tutup session yg sudah selesai (reservation_end_at lewat / walk-in basi).
  // 2. Promote reservasi yg waktunya tiba → open. Urutan ini penting: meja yg
  //    baru di-close bisa langsung dipakai reservasi berikutnya.
  await expireFinishedSessions(bar.id);
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

  // Map tableId → semua reservasi (urut by jam mulai). Satu meja bisa punya
  // banyak reservasi di slot berbeda — bottom sheet tampilkan semua + history.
  const reservationsByTable: Record<string, ActiveSessionView[]> = {};

  // History: reservasi yg sudah SELESAI (closed) DAN waktunya sudah lewat
  // (reservation_end_at <= now) — ditandai 'Selesai' di list jam.
  // Reservasi closed yg BELUM lewat (meja ditutup lebih awal / dibatalkan)
  // TIDAK masuk history → slot kembali Tersedia & bisa dibooking orang lain.
  const {
    start: windowStart,
    end: windowEnd,
    now,
  } = historyWindow(reservationConfig.bookingWindowDays);
  const historyRows = await db
    .select({
      id: tableSessions.id,
      table_id: tableSessions.tableId,
      table_label: tables.label,
      area_name: floorAreas.name,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      host_name: profiles.displayName,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(
      and(
        eq(floorAreas.barId, bar.id),
        eq(tableSessions.status, "closed"),
        gte(tableSessions.reservationAt, windowStart),
        lte(tableSessions.reservationAt, windowEnd),
        // Hanya yg waktunya sudah lewat = history sungguhan.
        lte(tableSessions.reservationEndAt, now)
      )
    );
  const historyByTable: Record<string, ActiveSessionView[]> = {};
  for (const h of historyRows) {
    if (!h.reservation_at) continue;
    (historyByTable[h.table_id] ??= []).push({
      id: h.id,
      table_id: h.table_id,
      table_label: h.table_label,
      area_id: "",
      area_name: h.area_name,
      status: "closed" as never,
      visibility: "public",
      title: null,
      vibe_tags: [],
      host_id: "",
      host_name: h.host_name,
      host_avatar: null,
      started_at: h.reservation_at.toISOString(),
      reservation_at: h.reservation_at.toISOString(),
      reservation_end_at: h.reservation_end_at?.toISOString() ?? null,
      member_count: 0,
      table_capacity: 0,
    });
  }

  const areasWithTables = await Promise.all(
    areas.map(async (area) => {
      const [tables, sessions] = await Promise.all([
        getTablesByArea(area.id),
        getActiveSessionsForArea(area.id),
      ]);
      const tablesWithSession: FloorMapTable[] = tables.map((t) => {
        const forTable = sessions.filter((s) => s.table_id === t.id);
        // Jadwal jam meja = session aktif yg punya reservation_at (reserved /
        // open hasil promote) + history reservasi closed. Walk-in murni
        // (reservation_at null) tidak masuk jadwal.
        const reservations = [
          // overdue (belum lunas) dikecualikan dari jadwal denah — tagihan
          // ditangani di home, bukan di sini.
          ...forTable.filter((s) => s.reservation_at && s.status !== "overdue"),
          ...(historyByTable[t.id] ?? []),
        ].sort((a, b) =>
          (a.reservation_at ?? "").localeCompare(b.reservation_at ?? "")
        );
        if (reservations.length > 0) {
          reservationsByTable[t.id] = reservations;
        }
        // active_session untuk denah: prioritaskan session open/locked (meja
        // sedang dipakai), kalau tidak ada pakai reservasi AKTIF terdekat
        // (bukan history closed — biar meja yg reservasinya selesai = available).
        // 'overdue' (belum lunas) SENGAJA tidak ditampilkan di denah — meja
        // tampil available; tagihan ditangani via banner home. Backend overdue
        // (tetap tertagih, tak auto-close) tidak terpengaruh.
        const activeReservations = forTable.filter(
          (s) => s.reservation_at && s.status !== "overdue"
        );
        const active =
          forTable.find(
            (s) => s.status === "open" || s.status === "locked"
          ) ??
          activeReservations[0] ??
          null;
        return { ...t, active_session: active };
      });
      return { area, tables: tablesWithSession };
    })
  );

  const profile = await getCurrentProfile();

  return (
    <>
      <BarFloorView
        bar={bar}
        areasWithTables={areasWithTables}
        reservationsByTable={reservationsByTable}
        operatingHours={operatingHours}
        slotIntervalMinutes={reservationConfig.slotIntervalMinutes}
        bookingWindowDays={reservationConfig.bookingWindowDays}
        userId={profile?.id ?? null}
      />
      <HomeBottomNav
        barId={bar.id}
        isAnon={!profile}
        avatarUrl={profile?.avatarUrl ?? null}
        displayName={profile?.displayName ?? null}
      />
    </>
  );
}
