"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FloorMap, type FloorMapTable } from "@/components/floor/FloorMap";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { formatIDR, cn } from "@/lib/utils";
import type { Bar, FloorArea, ActiveSessionView } from "@/types/db";
import type { OperatingHours } from "@/lib/settings-constants";


/** Format ISO reservation_at → "Hari ini · 20:00" / "Sabtu 14 Jun · 20:00". Client-safe. */

/** "HH:MM" dari ISO. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const HARI_SHORT = ["MIN", "SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];

/** groupKey tanggal selaras dgn slot: "today" | "tomorrow" | "YYYY-MM-DD". */
function dateGroupKey(date: Date): string {
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, now)) return "today";
  if (sameDay(date, tomorrow)) return "tomorrow";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Date objek dari groupKey (untuk sort + label). */
function groupKeyToDate(gk: string): Date {
  const now = new Date();
  if (gk === "today") return now;
  if (gk === "tomorrow") {
    const t = new Date(now);
    t.setDate(now.getDate() + 1);
    return t;
  }
  const [y, m, d] = gk.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function compareGroupKey(a: string, b: string): number {
  return groupKeyToDate(a).getTime() - groupKeyToDate(b).getTime();
}

/**
 * true kalau groupKey ini sebelum hari ini (start-of-day). Dipakai untuk
 * menyaring tanggal booking lampau (kemarin dst) dari strip tanggal — jadwal
 * hanya menampilkan hari ini ke depan.
 */
function isBeforeToday(gk: string): boolean {
  const d = groupKeyToDate(gk);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

/** Label hari + tanggal angka dari groupKey untuk strip. */
function groupKeyToParts(gk: string): { dayLabel: string; dateNum: number } {
  const d = groupKeyToDate(gk);
  return { dayLabel: HARI_SHORT[d.getDay()], dateNum: d.getDate() };
}


const DAY_KEYS_FLOOR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface HourRow {
  /** "20:00–21:00" */
  label: string;
  /** ISO jam mulai slot ini (untuk key + booking jam itu). */
  startIso: string;
  booked: boolean;
  /** true kalau slot dipakai session yg sudah aktif (open), bukan cuma reserved. */
  inUse?: boolean;
  /** true kalau slot ini sudah lewat (jam selesai < sekarang). */
  past?: boolean;
  host?: string;
  /** session id booking yg nge-hit slot ini (untuk Lihat Meja). */
  sessionId?: string;
}

/**
 * Bangun list SEMUA jam operasi di tanggal `gk`, ditandai booked/available.
 * Tiap baris = 1 slot interval (mis. 60 mnt): "10:00–11:00".
 * Booked kalau slot itu jatuh di dalam rentang reservasi mana pun.
 */
function buildHourRows(
  gk: string,
  dayReservations: ActiveSessionView[],
  hours: OperatingHours | undefined,
  slotMinutes: number,
  nowMs: number
): HourRow[] {
  if (!hours) {
    // Tanpa jam operasi: fallback ke list reservasi yang ada saja.
    return dayReservations
      .filter((r) => r.reservation_at)
      .map((r) => ({
        label: `${formatTime(r.reservation_at!)}–${r.reservation_end_at ? formatTime(r.reservation_end_at) : "?"}`,
        startIso: r.reservation_at!,
        booked: true,
        host: r.host_name,
        sessionId: r.id,
      }));
  }

  const date = groupKeyToDate(gk);
  const dayKey = DAY_KEYS_FLOOR[date.getDay()];
  const dh = hours[dayKey];
  if (!dh || dh.closed) return [];

  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const openMin = toMin(dh.open);
  const closeRaw = dh.close === "00:00" ? 24 * 60 : toMin(dh.close);
  const wraps = closeRaw <= openMin; // tutup setelah tengah malam
  // Cek apakah menit-dalam-hari (0..1439) termasuk jam operasi.
  // Wrap (mis. 13:00–03:00): operasi = [00:00..close] ∪ [open..24:00].
  // Normal: [open..close].
  const inOperating = (min: number) =>
    wraps ? min < closeRaw || min >= openMin : min >= openMin && min < closeRaw;

  // Rentang booked (ms epoch) untuk tanggal ini. inUse = session sudah aktif
  // (open/locked) hasil promote reservasi, bukan cuma reserved.
  const ranges = dayReservations
    .filter((r) => r.reservation_at && r.reservation_end_at)
    .map((r) => ({
      start: new Date(r.reservation_at!).getTime(),
      end: new Date(r.reservation_end_at!).getTime(),
      host: r.host_name,
      inUse: r.status === "open" || r.status === "locked",
      sessionId: r.id,
    }));

  // Iterasi per slot dalam HARI KALENDER yg sama (00:00 s/d <24:00). Slot dini
  // hari (mis. 00:00–03:00) = dini hari tanggal itu sendiri, jadi tampil di
  // atas & dihitung 'lewat' kalau sudah berlalu — bukan digulung ke besok.
  const rows: HourRow[] = [];
  const step = slotMinutes;
  for (let m = 0; m + step <= 24 * 60; m += step) {
    if (!inOperating(m)) continue;
    const slotStart = new Date(date);
    slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + step * 60 * 1000);
    const sMs = slotStart.getTime();
    const hit = ranges.find((r) => sMs >= r.start && sMs < r.end);
    rows.push({
      label: `${formatTime(slotStart.toISOString())}–${formatTime(slotEnd.toISOString())}`,
      startIso: slotStart.toISOString(),
      booked: !!hit,
      inUse: hit?.inUse,
      past: slotEnd.getTime() <= nowMs,
      host: hit?.host,
      sessionId: hit?.sessionId,
    });
  }
  return rows;
}

interface Props {
  bar: Bar;
  areasWithTables: Array<{ area: FloorArea; tables: FloorMapTable[] }>;
  /** tableId → semua reservasi 'reserved' (urut by jam mulai). */
  reservationsByTable?: Record<string, ActiveSessionView[]>;
  /** Jam operasi bar — untuk generate semua jam di bottom sheet. */
  operatingHours?: OperatingHours;
  /** Interval slot (menit) untuk generate jam. */
  slotIntervalMinutes?: number;
  /** Booking window (hari) untuk panjang strip tanggal. */
  bookingWindowDays?: number;
  /** Profile id user login (untuk bell notifikasi). null = anon. */
  userId?: string | null;
}

export function BarFloorView({
  bar,
  areasWithTables,
  reservationsByTable = {},
  operatingHours,
  slotIntervalMinutes = 60,
  bookingWindowDays = 7,
  userId = null,
}: Props) {
  const router = useRouter();
  const [activeAreaSlug, setActiveAreaSlug] = React.useState(
    areasWithTables[0]?.area.slug ?? ""
  );
  // Simpan cuma table_id supaya saat router.refresh() bawa data baru,
  // bottom sheet auto re-derive dari areasWithTables yang fresh
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    null
  );

  const activeArea = areasWithTables.find((a) => a.area.slug === activeAreaSlug);

  // Re-derive selectedTable dari props setiap render — jadi auto-update saat
  // floor data berubah (member nambah, payment, session closed, dll)
  const selectedTable = React.useMemo<FloorMapTable | null>(() => {
    if (!selectedTableId) return null;
    for (const { tables } of areasWithTables) {
      const found = tables.find((t) => t.id === selectedTableId);
      if (found) return found;
    }
    return null;
  }, [selectedTableId, areasWithTables]);

  const setSelectedTable = React.useCallback(
    (table: FloorMapTable | null) => {
      setSelectedTableId(table?.id ?? null);
    },
    []
  );

  // Subscribe SSE channel `bar:<barId>` supaya floor view auto-update saat
  // ada session baru / member berubah / order/payment di mana saja di bar.
  React.useEffect(() => {
    if (!bar.id) return;
    const es = new EventSource(`/api/realtime/bar/${bar.id}`);
    es.onmessage = () => router.refresh();
    es.onerror = () => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] bar:${bar.id} disconnected, retrying...`);
      }
    };
    return () => es.close();
  }, [bar.id, router]);

  return (
    <main className="flex-1 pb-32">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-primary/70">
              {bar.tagline}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">{bar.name}</h1>
          </div>
          {userId && <NotificationBell userId={userId} />}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-4">
          <LegendDot color="rgba(28,28,28,0.9)" border="rgba(255,255,255,0.15)" label="Available" />
          <LegendDot color="rgba(201,169,97,0.4)" border="#c9a961" label="Open table" pulse />
          <LegendDot color="rgba(59,130,246,0.2)" border="#3b82f6" label="Reserved" />
        </div>

        {activeArea && (
          <FloorMap
            // Remount saat ganti area → reset zoom/pan (canvas size berubah).
            key={activeArea.area.slug}
            canvasWidth={activeArea.area.canvas_width}
            canvasHeight={activeArea.area.canvas_height}
            tables={activeArea.tables}
            selectedTableId={selectedTable?.id ?? null}
            onSelectTable={setSelectedTable}
            className="bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a]"
          />
        )}

        {/* Area tabs — di bawah denah, rata tengah. Garis pemisah bawah
            menandai bahwa tab ini milik section denah (pisah dari Jadwal). */}
        {areasWithTables.length > 1 && (
          <div className="mt-4 pb-4 border-b border-border flex justify-center gap-2 flex-wrap">
            {areasWithTables.map(({ area, tables }) => {
              const openCount = tables.filter(
                (t) => t.active_session?.status === "open"
              ).length;
              const active = activeAreaSlug === area.slug;
              return (
                <button
                  key={area.id}
                  onClick={() => {
                    setActiveAreaSlug(area.slug);
                    setSelectedTable(null);
                  }}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition border ${
                    active
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  {area.name}
                  {openCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1">
                      {openCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Jadwal booking — list per tanggal (semua meja) */}
        <BookingSchedule
          reservationsByTable={reservationsByTable}
          bookingWindowDays={bookingWindowDays}
          onViewTable={(tableId) => setSelectedTableId(tableId)}
        />
      </div>

      {/* Bottom sheet: selected table — backdrop click closes */}
      {selectedTable && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 animate-in fade-in"
            onClick={() => setSelectedTable(null)}
            aria-hidden="true"
          />
          <TableSheet
            table={selectedTable}
            reservations={reservationsByTable[selectedTable.id] ?? []}
            operatingHours={operatingHours}
            slotIntervalMinutes={slotIntervalMinutes}
            bookingWindowDays={bookingWindowDays}
            onClose={() => setSelectedTable(null)}
          />
        </>
      )}
    </main>
  );
}

function LegendDot({
  color,
  border,
  label,
  pulse,
}: {
  color: string;
  border: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block w-3 h-3 rounded-full ${pulse ? "animate-pulse" : ""}`}
        style={{ background: color, borderColor: border, borderWidth: 1, borderStyle: "solid" }}
      />
      <span>{label}</span>
    </div>
  );
}

// ============================================================
// BOOKING SCHEDULE — list booking per tanggal (semua meja)
// ============================================================

function BookingSchedule({
  reservationsByTable,
  bookingWindowDays = 7,
  onViewTable,
}: {
  reservationsByTable: Record<string, ActiveSessionView[]>;
  bookingWindowDays?: number;
  onViewTable: (tableId: string) => void;
}) {
  const [nowMs] = React.useState(() => Date.now());

  // Kumpulkan semua booking lintas meja, kelompokkan per tanggal (groupKey).
  const byDate = React.useMemo(() => {
    const all = Object.values(reservationsByTable).flat();
    const map = new Map<string, ActiveSessionView[]>();
    for (const r of all) {
      if (!r.reservation_at) continue;
      const gk = dateGroupKey(new Date(r.reservation_at));
      (map.get(gk) ?? map.set(gk, []).get(gk)!).push(r);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        (a.reservation_at ?? "").localeCompare(b.reservation_at ?? "")
      );
    }
    return map;
  }, [reservationsByTable]);

  // Strip tanggal: hari ini s/d booking window (mis. 7 hari) + tanggal lain
  // dalam window yg punya booking. TIDAK menampilkan tanggal lampau (kemarin
  // dst) walau ada booking di sana.
  const dateChips = React.useMemo(() => {
    const keys = new Set<string>();
    for (let i = 0; i <= Math.max(1, bookingWindowDays); i++) {
      keys.add(dateGroupKey(addDays(nowMs, i)));
    }
    for (const gk of byDate.keys()) {
      if (!isBeforeToday(gk)) keys.add(gk);
    }
    return Array.from(keys).sort(compareGroupKey);
  }, [byDate, bookingWindowDays, nowMs]);

  const [activeDate, setActiveDate] = React.useState<string>("today");
  const dayBookings = byDate.get(activeDate) ?? [];

  return (
    <div className="mt-6 space-y-3">
      <h2 className="text-xs uppercase tracking-widest font-semibold text-foreground/80">
        Jadwal Booking
      </h2>

      {/* Strip tanggal */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {dateChips.map((gk) => {
          const active = activeDate === gk;
          const { dayLabel, dateNum } = groupKeyToParts(gk);
          return (
            <button
              key={gk}
              type="button"
              onClick={() => setActiveDate(gk)}
              className={cn(
                "shrink-0 w-14 py-2 rounded-lg border flex flex-col items-center gap-0.5 transition",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              )}
            >
              <span className="text-[10px] font-medium tracking-wide">
                {dayLabel}
              </span>
              <span className="text-lg font-semibold leading-none tabular-nums">
                {dateNum}
              </span>
            </button>
          );
        })}
      </div>

      {/* List booking tanggal terpilih */}
      {dayBookings.length > 0 ? (
        <Card className="divide-y divide-border">
          {dayBookings.map((r) => {
            const ended =
              !!r.reservation_end_at &&
              new Date(r.reservation_end_at).getTime() <= nowMs;
            const inUse = r.status === "open" || r.status === "locked";
            const statusLabel = ended
              ? "Selesai"
              : inUse
                ? "Sedang dipakai"
                : "Dibooking";
            const statusColor = ended
              ? "text-muted-foreground/60"
              : inUse
                ? "text-emerald-400"
                : "text-blue-400";
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onViewTable(r.table_id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition hover:bg-muted/40"
              >
                <Badge variant="default" className="text-[10px] px-1.5 shrink-0">
                  {r.table_label}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{r.host_name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {r.reservation_at ? formatTime(r.reservation_at) : "?"}
                    {r.reservation_end_at
                      ? `–${formatTime(r.reservation_end_at)}`
                      : ""}
                    {r.area_name ? ` · ${r.area_name}` : ""}
                  </p>
                </div>
                <span className={cn("text-[11px] shrink-0", statusColor)}>
                  {statusLabel}
                </span>
              </button>
            );
          })}
        </Card>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
          Belum ada booking di tanggal ini.
        </Card>
      )}
    </div>
  );
}

/** Tanggal baru = nowMs + n hari (helper non-komponen, aman dari purity). */
function addDays(baseMs: number, days: number): Date {
  const d = new Date(baseMs);
  d.setDate(d.getDate() + days);
  return d;
}

function TableSheet({
  table,
  reservations,
  operatingHours,
  slotIntervalMinutes,
  bookingWindowDays = 7,
  onClose,
}: {
  table: FloorMapTable;
  reservations: ActiveSessionView[];
  operatingHours?: OperatingHours;
  slotIntervalMinutes?: number;
  bookingWindowDays?: number;
  onClose: () => void;
}) {
  const session = table.active_session;
  const isOpen = session?.status === "open";
  const isReserved = session?.status === "reserved";

  // Kelompokkan reservasi per tanggal (groupKey).
  const byDate = React.useMemo(() => {
    const map = new Map<string, ActiveSessionView[]>();
    for (const r of reservations) {
      if (!r.reservation_at) continue;
      const gk = dateGroupKey(new Date(r.reservation_at));
      const list = map.get(gk) ?? [];
      list.push(r);
      map.set(gk, list);
    }
    return map;
  }, [reservations]);

  // Strip tanggal: hari ini sampai booking window (mis. 7 hari), plus tanggal
  // dalam window yg punya reservasi. TIDAK menampilkan tanggal lampau (kemarin
  // dst) walau ada booking — jadwal hanya hari ini ke depan.
  const dateChips = React.useMemo(() => {
    const keys = new Set<string>();
    const now = new Date();
    for (let i = 0; i <= Math.max(1, bookingWindowDays); i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      keys.add(dateGroupKey(d));
    }
    for (const gk of byDate.keys()) {
      if (!isBeforeToday(gk)) keys.add(gk);
    }
    return Array.from(keys).sort(compareGroupKey);
  }, [byDate, bookingWindowDays]);

  const [activeDate, setActiveDate] = React.useState<string>(
    () => dateChips[0] ?? "today"
  );
  // Stabil per mount (lazy init) — hindari Date.now() di render body.
  const [nowMs] = React.useState(() => Date.now());

  // List SEMUA jam operasi di tanggal terpilih, ditandai booked/available.
  const hourRows = React.useMemo(
    () =>
      buildHourRows(
        activeDate,
        byDate.get(activeDate) ?? [],
        operatingHours,
        slotIntervalMinutes ?? 60,
        nowMs
      ),
    [activeDate, byDate, operatingHours, slotIntervalMinutes, nowMs]
  );

  // ── Pilih rentang jam (untuk booking) — pola klik mulai→selesai spt form ──
  const slotMs = (slotIntervalMinutes ?? 60) * 60 * 1000;
  const [selStart, setSelStart] = React.useState<string>("");
  const [selEnd, setSelEnd] = React.useState<string>("");

  // Reset pilihan saat ganti tanggal.
  function changeDate(gk: string) {
    setActiveDate(gk);
    setSelStart("");
    setSelEnd("");
  }

  // Slot yg bisa dipilih = tersedia (tidak booked, tidak lewat).
  function isSelectable(h: HourRow) {
    return !h.booked && !h.past;
  }

  // Klik slot tersedia: klik mulai → set; klik dalam rentang → batal; klik
  // setelah → perpanjang; klik sebelum → mulai baru. Tidak boleh menembus
  // slot non-selectable (booked/lewat) di antara.
  function clickSlot(h: HourRow) {
    const iso = h.startIso;
    const ms = new Date(iso).getTime();
    if (!selStart) {
      setSelStart(iso);
      setSelEnd("");
      return;
    }
    const startMs = new Date(selStart).getTime();
    const endMs = selEnd ? new Date(selEnd).getTime() : startMs + slotMs;
    if (ms >= startMs && ms < endMs) {
      // Klik di dalam rentang → uncheck dari slot itu (bukan batal semua).
      if (ms === startMs) {
        // Klik jam mulai → geser mulai maju 1 slot; kalau jadi kosong → batal.
        const newStart = startMs + slotMs;
        if (newStart >= endMs) {
          setSelStart("");
          setSelEnd("");
        } else {
          setSelStart(new Date(newStart).toISOString());
        }
        return;
      }
      // Klik di tengah/akhir → potong: selesai = slot yg diklik.
      setSelEnd(iso);
      return;
    }
    if (ms < startMs) {
      setSelStart(iso);
      setSelEnd("");
      return;
    }
    // klik setelah mulai → perpanjang, tapi pastikan semua slot di [start, ms]
    // selectable (tidak ada booked/lewat di tengah).
    const between = hourRows.filter((r) => {
      const t = new Date(r.startIso).getTime();
      return t >= startMs && t <= ms;
    });
    if (between.some((r) => !isSelectable(r))) {
      // ada slot tak bisa dipilih di antara → mulai baru dari sini
      setSelStart(iso);
      setSelEnd("");
      return;
    }
    setSelEnd(new Date(ms + slotMs).toISOString());
  }

  // Set ISO yg termasuk rentang terpilih (untuk highlight).
  const selRange = React.useMemo(() => {
    const set = new Set<string>();
    if (!selStart) return set;
    const startMs = new Date(selStart).getTime();
    const endMs = selEnd ? new Date(selEnd).getTime() : startMs + slotMs;
    for (let t = startMs; t < endMs; t += slotMs) {
      set.add(new Date(t).toISOString());
    }
    return set;
  }, [selStart, selEnd, slotMs]);

  const effEnd = selEnd || (selStart ? new Date(new Date(selStart).getTime() + slotMs).toISOString() : "");

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4">
      <div className="w-full h-full sm:h-auto sm:max-w-md sm:max-h-[90vh] flex flex-col bg-card border border-border sm:rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-4 sm:p-5 border-b border-border shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="default" className="text-xs">
                {table.label}
              </Badge>
              {isReserved && (
                <Badge
                  variant="outline"
                  className="text-xs border-blue-500/50 text-blue-400"
                >
                  Reserved
                </Badge>
              )}
              <span className="text-xs text-muted-foreground capitalize">
                {table.shape} · {table.capacity} seats
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-semibold">
              {isOpen ? "Meja sedang digunakan" : "Jadwal meja"}
            </h2>
            {isOpen && session ? (
              <p className="text-sm text-muted-foreground mt-0.5">
                Saat ini dipakai oleh host{" "}
                <span className="text-foreground font-medium">
                  {session.host_name}
                </span>
                .
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">
                Pilih jam buat nongkrong di meja ini ✨
              </p>
            )}
            {(table.min_spend ?? 0) > 0 && (
              <p className="text-xs text-primary mt-1">
                Min spend: {formatIDR(table.min_spend!)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm shrink-0"
            aria-label="Close"
          >
            Tutup
          </button>
        </div>

        {/* Body: strip tanggal + list jam (scrollable). Tampil untuk semua
            semua meja kecuali locked (full). Meja open boleh dibooking jam
            lain — tampilkan jadwal + info kecil 'sedang dipakai'. */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {session?.status !== "locked" ? (
            <>
              {isOpen && (
                <div className="mb-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  Meja ini sedang dipakai sekarang (host {session?.host_name}).
                  Kamu tetap bisa booking untuk jam lain.
                </div>
              )}
              {/* Strip tanggal */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                {dateChips.map((gk) => {
                  const active = activeDate === gk;
                  const { dayLabel, dateNum } = groupKeyToParts(gk);
                  return (
                    <button
                      key={gk}
                      type="button"
                      onClick={() => changeDate(gk)}
                      className={cn(
                        "shrink-0 w-14 py-2 rounded-lg border flex flex-col items-center gap-0.5 transition",
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                      )}
                    >
                      <span className="text-[10px] font-medium tracking-wide">
                        {dayLabel}
                      </span>
                      <span className="text-lg font-semibold leading-none tabular-nums">
                        {dateNum}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* List SEMUA jam operasi (booked / tersedia) */}
              {hourRows.length > 0 ? (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {hourRows.map((h) => {
                    // Status & warna jam:
                    // - lewat + booking → "Selesai" (abu)
                    // - lewat + kosong → "Lewat" (abu redup)
                    // - aktif dipakai → "Sedang dipakai" (biru)
                    // - dibooking (belum mulai) → "Dibooking" (biru)
                    // - kosong & belum lewat → "Tersedia" (hijau)
                    const selectable = isSelectable(h);
                    const picked = selRange.has(h.startIso);
                    const status = picked
                      ? "Dipilih ✓"
                      : h.past
                        ? h.booked
                          ? `Selesai${h.host ? ` · a/n ${h.host}` : ""}`
                          : "Lewat"
                        : h.booked
                          ? `${h.inUse ? "Sedang dipakai" : "Dibooking"}${h.host ? ` · a/n ${h.host}` : ""}`
                          : "Tersedia";
                    const timeColor = picked
                      ? "text-primary"
                      : h.past
                        ? "text-muted-foreground/50"
                        : h.booked
                          ? "text-blue-400"
                          : "text-foreground";
                    const statusColor = picked
                      ? "text-primary"
                      : h.past
                        ? "text-muted-foreground/50"
                        : h.booked
                          ? "text-muted-foreground"
                          : "text-emerald-500/80";

                    const inner = (
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-sm tabular-nums",
                            timeColor
                          )}
                        >
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          {h.label}
                        </span>
                        <span className={cn("text-xs truncate", statusColor)}>
                          {status}
                        </span>
                      </div>
                    );

                    const rowClass = cn(
                      "block w-full text-left px-3 py-2.5 transition",
                      picked
                        ? "bg-primary/15"
                        : h.past
                          ? "bg-muted/20"
                          : h.booked
                            ? "bg-muted/30"
                            : "",
                      (selectable || h.sessionId) && !picked && "hover:bg-muted/50",
                      (selectable || h.sessionId) && "cursor-pointer"
                    );

                    // Ada booking → Link lihat session. Tersedia → pilih rentang.
                    if (h.sessionId) {
                      return (
                        <Link
                          key={h.startIso}
                          href={`/session/${h.sessionId}`}
                          className={rowClass}
                        >
                          {inner}
                        </Link>
                      );
                    }
                    if (selectable) {
                      return (
                        <button
                          key={h.startIso}
                          type="button"
                          onClick={() => clickSlot(h)}
                          className={rowClass}
                        >
                          {inner}
                        </button>
                      );
                    }
                    return (
                      <div key={h.startIso} className={rowClass}>
                        {inner}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  Belum ada booking di tanggal ini.
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Meja ini sedang dipakai. Hanya bisa di-join lewat link invite
              dari host.
            </p>
          )}
        </div>

        {/* Footer: tombol booking — muncul saat ada rentang jam terpilih */}
        {selStart && (
          <div className="border-t border-border p-4 sm:p-5 shrink-0">
            <p className="text-xs text-muted-foreground mb-2 text-center">
              Terpilih: {formatTime(selStart)}–{formatTime(effEnd)}
            </p>
            <Button variant="gold" size="lg" className="w-full" asChild>
              <Link
                href={`/open-table?tableId=${table.id}&start=${encodeURIComponent(selStart)}&end=${encodeURIComponent(effEnd)}`}
              >
                Booking jam ini
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
