"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FloorMap, type FloorMapTable } from "@/components/floor/FloorMap";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SohoGlow } from "@/components/ui/soho-glow";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Banknote,
  Check,
  Clock,
  Loader2,
  Map as MapIcon,
  MapPin,
  UtensilsCrossed,
} from "lucide-react";
import { formatIDR, cn, initials } from "@/lib/utils";
import { MenuList } from "@/components/menu/MenuList";
import { PayAtCashierCountdown } from "@/components/session/PayAtCashierCountdown";
import type {
  Bar,
  FloorArea,
  ActiveSessionView,
  MenuCategoryTree,
  SessionVisibility,
} from "@/types/db";
import type { OperatingHours } from "@/lib/settings-constants";


/** Format ISO reservation_at → "Hari ini · 20:00" / "Sabtu 14 Jun · 20:00". Client-safe. */

/** "HH:MM" dari ISO. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const HARI_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const BULAN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Kunci hari kalender (YYYY-MM-DD) dari ISO — untuk deteksi ganti tanggal. */
function calDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
/** Label tanggal separator, mis. "Fri, 10 Jul". */
function dayHeaderLabel(iso: string): string {
  const d = new Date(iso);
  return `${HARI_SHORT[d.getDay()]}, ${d.getDate()} ${BULAN_SHORT[d.getMonth()]}`;
}

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

/** Label tipe meja (visibility) untuk slot booking. */
function visibilityLabel(v?: SessionVisibility): string {
  if (v === "public") return "Public";
  if (v === "friends") return "Friends";
  if (v === "invite_only") return "Invite";
  return "";
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
  /** visibility booking yg nge-hit slot ini (public/friends/invite_only). */
  visibility?: SessionVisibility;
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
        visibility: r.visibility,
      }));
  }

  const date = groupKeyToDate(gk);
  const dayKey = DAY_KEYS_FLOOR[date.getDay()];
  const dh = hours[dayKey];
  // Tutup kalau: hari tak ada, ditandai closed, atau jam open/close tak lengkap
  // (data lama/rusak) — hindari crash `.split` pada undefined.
  if (!dh || dh.closed || !dh.open || !dh.close) return [];

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
  // Reservasi yg SUDAH SELESAI (end <= now) DIKECUALIKAN — slot-nya bebas lagi,
  // jadi tampil "Tersedia" (bisa dibooking lagi), bukan "booked by X" yg nyangkut
  // & nge-link ke session mati (403). Booking basi Yusa 00-03 hilang dari sini.
  const ranges = dayReservations
    .filter(
      (r) =>
        r.reservation_at &&
        r.reservation_end_at &&
        new Date(r.reservation_end_at).getTime() > nowMs
    )
    .map((r) => ({
      start: new Date(r.reservation_at!).getTime(),
      end: new Date(r.reservation_end_at!).getTime(),
      host: r.host_name,
      inUse: r.status === "open" || r.status === "locked",
      sessionId: r.id,
      visibility: r.visibility,
    }));

  // Slot dibangun dalam URUTAN WAKTU NYATA (kontinu), bukan per hari kalender:
  // - Hari NORMAL (tak wrap): slot open→close di tanggal itu.
  // - Hari WRAP (tutup lewat tengah malam, mis. 18:00–02:00): satu daftar
  //   kontinu — slot malam (open→24:00) di tanggal ini, LALU dini hari
  //   (00:00→close) di tanggal BERIKUTNYA. Jadi 23:00 disusul 00:00 (besok),
  //   memungkinkan booking lintas hari sebagai satu rentang yg nyambung.
  const rows: HourRow[] = [];
  const step = slotMinutes;
  const pushSlot = (slotStart: Date) => {
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
      visibility: hit?.visibility,
    });
  };

  if (wraps) {
    // Malam tanggal ini: [open .. 24:00)
    for (let m = openMin; m + step <= 24 * 60; m += step) {
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);
      pushSlot(slotStart);
    }
    // Dini hari BESOK: [00:00 .. close)
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    for (let m = 0; m + step <= closeRaw; m += step) {
      const slotStart = new Date(next);
      slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);
      pushSlot(slotStart);
    }
  } else {
    // Hari normal: [open .. close) di tanggal ini.
    for (let m = 0; m + step <= 24 * 60; m += step) {
      if (!inOperating(m)) continue;
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);
      pushSlot(slotStart);
    }
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
  /** Menu bar (per kategori + items) untuk tab Menu. */
  menu?: MenuCategoryTree[];
  /** Session yang DIIKUTI user ini → ditandai "You're in" di jadwal. */
  joinedIds?: string[];
}

export function BarFloorView({
  bar,
  areasWithTables,
  reservationsByTable = {},
  operatingHours,
  slotIntervalMinutes = 60,
  bookingWindowDays = 7,
  joinedIds,
  userId = null,
  menu = [],
}: Props) {
  const router = useRouter();
  const [mainTab, setMainTab] = React.useState<"floor" | "menu">("floor");
  const [activeAreaSlug, setActiveAreaSlug] = React.useState(
    areasWithTables[0]?.area.slug ?? ""
  );
  // Simpan cuma table_id supaya saat router.refresh() bawa data baru,
  // bottom sheet auto re-derive dari areasWithTables yang fresh
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    null
  );
  // Tanggal terpilih di Booking Schedule — DIANGKAT ke sini supaya denah (floor)
  // ikut tanggal ini. "today" = hari ini. groupKey ("YYYY-MM-DD") = tanggal lain.
  const [activeDate, setActiveDate] = React.useState<string>("today");

  // Denah IKUT tanggal terpilih di Booking Schedule.
  // - HARI INI: meja MERAH kalau sedang dipakai (open/locked, dari server) ATAU
  //   punya reservasi hari ini yg belum lewat.
  // - TANGGAL LAIN: meja MERAH kalau punya reservasi di tanggal itu; kalau tak
  //   ada → ABU (available). Live session (open/locked) hanya relevan hari ini.
  // Sumber reservasi: reservationsByTable (semua reservasi 'reserved' per meja).
  // Stabil per mount (lazy init) — hindari Date.now() di memo/render body.
  const [nowMsFloor] = React.useState(() => Date.now());
  const dateAwareAreas = React.useMemo(() => {
    const isToday = activeDate === "today";
    return areasWithTables.map(({ area, tables }) => ({
      area,
      tables: tables.map((t): FloorMapTable => {
        // Live session (open/locked) dari server — cuma relevan HARI INI.
        const liveNow = isToday ? t.active_session : null;
        if (liveNow) return { ...t, active_session: liveNow };
        // Cari reservasi meja ini yg jatuh di tanggal terpilih & BELUM lewat.
        const resOnDate = (reservationsByTable[t.id] ?? []).find(
          (r) =>
            r.reservation_at &&
            r.status === "reserved" &&
            dateGroupKey(new Date(r.reservation_at)) === activeDate &&
            (!r.reservation_end_at ||
              new Date(r.reservation_end_at).getTime() > nowMsFloor)
        );
        return { ...t, active_session: resOnDate ?? null };
      }),
    }));
  }, [areasWithTables, reservationsByTable, activeDate, nowMsFloor]);

  const activeArea = dateAwareAreas.find((a) => a.area.slug === activeAreaSlug);

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
    <main className="relative flex-1 pb-32">
      <SohoGlow />
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <span className="inline-flex h-9 w-9 rounded-lg overflow-hidden border border-border shadow-md shrink-0">
            <Image
              src="/logo-soho.jpeg"
              alt="SOHO"
              width={36}
              height={36}
              className="h-full w-full object-cover"
            />
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate">
              Booking
            </h1>
          </div>
          {userId && <NotificationBell userId={userId} />}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Tab switcher: Denah vs Menu */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border w-full mb-4">
          <MainTabButton
            icon={<MapIcon className="h-3.5 w-3.5" />}
            label="Floor"
            active={mainTab === "floor"}
            onClick={() => setMainTab("floor")}
          />
          <MainTabButton
            icon={<UtensilsCrossed className="h-3.5 w-3.5" />}
            label="Menu"
            active={mainTab === "menu"}
            onClick={() => setMainTab("menu")}
          />
        </div>

        {mainTab === "menu" ? (
          <MenuList menu={menu} />
        ) : (
          // Seluruh isi tab Floor jadi SATU area scroll (denah + jadwal). Yg
          // di luar (tab Floor/Menu) tetap diam — persis pola tab Menu. Tinggi
          // = sisa layar s/d tepat di atas bottom nav.
          <div className="max-h-[calc(100dvh-13rem)] overflow-y-auto overscroll-contain -mx-4 sm:-mx-6 px-4 sm:px-6">
        {/* Legend — denah cerminkan kondisi SEKARANG: Available (abu) & sedang
            dipakai (merah). Reservasi tak mewarnai meja (info di jadwal). */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-4">
          <LegendDot color="rgba(28,28,28,0.9)" border="rgba(255,255,255,0.15)" label="Available" />
          <LegendDot color="rgba(225, 29, 42,0.4)" border="#e11d2a" label="In use" pulse />
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

        {/* Jadwal booking — list per tanggal (semua meja). activeDate DIANGKAT
            ke parent supaya denah ikut tanggal terpilih. */}
        <BookingSchedule
          reservationsByTable={reservationsByTable}
          bookingWindowDays={bookingWindowDays}
          activeDate={activeDate}
          onDateChange={setActiveDate}
          joinedIds={joinedIds}
          viewerId={userId}
        />
          </div>
        )}
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
            // key = table.id → REMOUNT tiap ganti meja. Tanpa ini, React reuse
            // instance → state internal (selStart/selEnd/activeDate) nyangkut:
            // slot yg dipilih di meja sebelumnya tampil "Selected ✓" di meja baru.
            key={selectedTable.id}
            table={selectedTable}
            reservations={reservationsByTable[selectedTable.id] ?? []}
            operatingHours={operatingHours}
            slotIntervalMinutes={slotIntervalMinutes}
            bookingWindowDays={bookingWindowDays}
            // Buka sheet di tanggal yg sedang dipilih di denah (biar nyambung).
            initialDate={activeDate}
            onClose={() => setSelectedTable(null)}
          />
        </>
      )}
    </main>
  );
}

function MainTabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
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
  activeDate,
  onDateChange,
  joinedIds,
  viewerId,
}: {
  reservationsByTable: Record<string, ActiveSessionView[]>;
  bookingWindowDays?: number;
  /** Tanggal terpilih (dikontrol parent supaya denah ikut). */
  activeDate: string;
  onDateChange: (gk: string) => void;
  /** Session yang DIIKUTI user → badge "You're in". */
  joinedIds?: string[];
  /** Profile id penonton — badge tak tampil di booking miliknya sendiri. */
  viewerId?: string | null;
}) {
  const router = useRouter();
  const [nowMs] = React.useState(() => Date.now());
  const joined = React.useMemo(() => new Set(joinedIds ?? []), [joinedIds]);

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

  // activeDate dikontrol parent (biar denah ikut). Klik chip → onDateChange.
  const dayBookings = byDate.get(activeDate) ?? [];

  return (
    <div className="mt-6 space-y-3">
      <h2 className="text-xs uppercase tracking-widest font-semibold text-foreground/80">
        Booking Schedule
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
              onClick={() => onDateChange(gk)}
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

      {/* List booking tanggal terpilih — ikut aliran normal halaman. */}
      {dayBookings.length > 0 ? (
        <Card className="divide-y divide-border">
          {dayBookings.map((r) => {
            const ended =
              !!r.reservation_end_at &&
              new Date(r.reservation_end_at).getTime() <= nowMs;
            const inUse = r.status === "open" || r.status === "locked";
            const statusLabel = ended
              ? "Done"
              : inUse
                ? "In use"
                : "Booked";
            const statusColor = ended
              ? "text-muted-foreground/60"
              : inUse
                ? "text-emerald-400"
                : "text-blue-400";
            // Booking yg SUDAH SELESAI ("Done") = session mati → jangan link ke
            // /session (user bukan member → 403). Tampil sbg baris biasa (info
            // history saja). Yg masih aktif/akan datang tetap bisa diklik.
            const inner = (
              <>
                {/* Avatar host */}
                <Avatar className="h-9 w-9 shrink-0">
                  {r.host_avatar && (
                    <AvatarImage src={r.host_avatar} alt={r.host_name} />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {initials(r.host_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{r.host_name}</p>
                  {/* Deskripsi booking (title) — kalau ada. */}
                  {r.title && (
                    <p className="text-xs italic text-muted-foreground/90 truncate">
                      {r.title}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {r.reservation_at ? formatTime(r.reservation_at) : "?"}
                    {r.reservation_end_at
                      ? `–${formatTime(r.reservation_end_at)}`
                      : ""}
                  </p>
                  {/* Visibility (public/friends/invite) + room */}
                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {visibilityLabel(r.visibility)}
                    </Badge>
                    {r.area_name && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/80">
                        <MapPin className="h-3 w-3" />
                        {r.area_name}
                      </span>
                    )}
                    {/* Penanda user ikut di booking ini. Host TIDAK ditandai —
                        dia jelas tahu itu miliknya sendiri. */}
                    {joined.has(r.id) && r.host_id !== viewerId && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 border border-primary/40 px-1.5 py-0 text-[10px] font-medium text-primary">
                        <Check className="h-3 w-3" /> You&apos;re in
                      </span>
                    )}
                  </div>
                  {/* Vibe meja — di bawah baris public/room. */}
                  {r.vibe_tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.vibe_tags.slice(0, 4).map((v) => (
                        <span
                          key={v}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
                        >
                          {v}
                        </span>
                      ))}
                      {r.vibe_tags.length > 4 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          +{r.vibe_tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                  {/* DP pay-at-cashier milik viewer masih pending → arahan
                      "segera ke kasir" + countdown. Habis → refresh (server
                      sudah batalkan booking → baris ini hilang). */}
                  {r.dp_pending_cashier?.expires_at && (
                    <PayAtCashierCountdown
                      expiresAt={r.dp_pending_cashier.expires_at}
                      onExpire={() => router.refresh()}
                    >
                      {(mmss) => (
                        <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-[11px] text-amber-400">
                          <Banknote className="h-3 w-3 shrink-0" />
                          <span className="font-medium">
                            Pay at the cashier to confirm
                          </span>
                          <span className="ml-auto tabular-nums font-semibold rounded bg-amber-500/20 px-1.5 py-0.5">
                            {mmss}
                          </span>
                        </div>
                      )}
                    </PayAtCashierCountdown>
                  )}
                </div>
                {/* Kanan: nomor meja (atas) + status + sisa kursi (bawah) */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="default" className="text-[10px] px-1.5">
                    {r.table_label}
                  </Badge>
                  <span className={cn("text-[11px]", statusColor)}>
                    {statusLabel}
                  </span>
                  {/* Sisa kursi / Full — kalau kapasitas diketahui. */}
                  {r.table_capacity > 0 &&
                    (r.table_capacity - r.member_count > 0 ? (
                      <span className="text-[10px] text-muted-foreground/80">
                        {r.table_capacity - r.member_count} seats left
                      </span>
                    ) : (
                      <span className="text-[10px] text-primary/80">Full</span>
                    ))}
                </div>
              </>
            );
            const rowCls =
              "w-full flex items-start gap-3 px-3 py-2.5 text-left";
            return ended ? (
              <div key={r.id} className={cn(rowCls, "opacity-70")}>
                {inner}
              </div>
            ) : (
              <Link
                key={r.id}
                href={`/session/${r.id}`}
                className={cn(rowCls, "transition hover:bg-muted/40")}
              >
                {inner}
              </Link>
            );
          })}
        </Card>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
          No bookings on this date yet.
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
  initialDate,
  onClose,
}: {
  table: FloorMapTable;
  reservations: ActiveSessionView[];
  operatingHours?: OperatingHours;
  slotIntervalMinutes?: number;
  bookingWindowDays?: number;
  /** Tanggal awal sheet — ikut tanggal yg dipilih di denah. */
  initialDate?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [navigating, setNavigating] = React.useState(false);
  const session = table.active_session;
  const isOpen = session?.status === "open";
  const isReserved = session?.status === "reserved";

  // GUARD click-through: sheet muncul TEPAT di bawah kursor saat klik meja
  // (onPointerUp di FloorMap). "Ghost click" bawaan browser lalu nembus ke slot
  // jam di posisi kursor yg sama → 1 klik meja = slot ikut ke-klik.
  //
  // Bulletproof (tak bergantung timing): slot hanya diproses SETELAH ada
  // pointerdown SUNGGUHAN yang dimulai di dalam SHEET. Ghost click tak
  // membawa pointerdown → armedRef tetap false → tertolak, berapa lama pun
  // jeda ghost-nya. Mouse/keyboard: pointerdown/klik asli langsung meng-arm,
  // jadi tak ada delay yang terasa.
  const armedRef = React.useRef(false);

  // Ref chip tanggal yg aktif → auto-scroll strip supaya tanggal terpilih
  // (dari denah) langsung kelihatan di tengah, bukan mulai dari kiri.
  const activeChipRef = React.useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => {
    activeChipRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
    });
  }, []);

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

  // Buka di tanggal yg dipilih di denah (initialDate) kalau valid; else hari ini.
  const [activeDate, setActiveDate] = React.useState<string>(() =>
    initialDate && dateChips.includes(initialDate)
      ? initialDate
      : dateChips[0] ?? "today"
  );
  // Stabil per mount (lazy init) — hindari Date.now() di render body.
  const [nowMs] = React.useState(() => Date.now());

  // List SEMUA jam operasi di tanggal terpilih, ditandai booked/available.
  // Kirim SEMUA reservasi (bukan cuma tanggal ini) — buildHourRows menandai
  // slot berdasarkan rentang ms absolut, jadi slot dini hari lintas tanggal
  // (wrap) tetap ketahuan booked walau reservasinya di grup tanggal berikutnya.
  const hourRows = React.useMemo(
    () =>
      buildHourRows(
        activeDate,
        reservations,
        operatingHours,
        slotIntervalMinutes ?? 60,
        nowMs
      ),
    [activeDate, reservations, operatingHours, slotIntervalMinutes, nowMs]
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
    // Tolak ghost-click: hanya proses kalau pointer benar-benar ditekan di
    // dalam sheet lebih dulu. Ghost click (tanpa pointerdown) tertolak.
    if (!armedRef.current) return;
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
      <div
        // Pointer SUNGGUHAN mulai di dalam sheet → arm guard slot (cegah
        // ghost-click tembus dari tap yg membuka sheet).
        onPointerDown={() => {
          armedRef.current = true;
        }}
        className="w-full h-full sm:h-auto sm:max-w-md sm:max-h-[90vh] flex flex-col bg-card border border-border sm:rounded-2xl shadow-2xl"
      >
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
              {isOpen ? "Table in use" : "Table schedule"}
            </h2>
            {isOpen && session ? (
              <p className="text-sm text-muted-foreground mt-0.5">
                Currently used by host{" "}
                <span className="text-foreground font-medium">
                  {session.host_name}
                </span>
                .
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">
                Pick a time to hang out at this table ✨
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
            Close
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
                  This table is in use right now (host {session?.host_name}).
                  You can still book it for another time.
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
                      ref={active ? activeChipRef : undefined}
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
                <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  {hourRows.map((h, idx) => {
                    // Separator tanggal: tampil kalau slot ini ganti hari
                    // kalender dari slot sebelumnya (mis. 23:00 → 00:00 besok),
                    // supaya jelas "00:00" itu hari berikutnya (lintas hari).
                    const prev = idx > 0 ? hourRows[idx - 1] : null;
                    const showDaySep =
                      !prev || calDayKey(prev.startIso) !== calDayKey(h.startIso);
                    // Status & warna jam:
                    // - lewat + booking → "Selesai" (abu)
                    // - lewat + kosong → "Lewat" (abu redup)
                    // - aktif dipakai → "Sedang dipakai" (biru)
                    // - dibooking (belum mulai) → "Dibooking" (biru)
                    // - kosong & belum lewat → "Tersedia" (hijau)
                    const selectable = isSelectable(h);
                    const picked = selRange.has(h.startIso);
                    const visLabel = visibilityLabel(h.visibility);
                    const status = picked
                      ? "Selected ✓"
                      : h.past
                        ? h.booked
                          ? `Done${h.host ? ` · by ${h.host}` : ""}`
                          : "Past"
                        : h.booked
                          ? `${h.inUse ? "In use" : "Booked"}${h.host ? ` · by ${h.host}` : ""}`
                          : "Available";
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
                            "inline-flex items-center gap-1.5 text-sm tabular-nums shrink-0",
                            timeColor
                          )}
                        >
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          {h.label}
                        </span>
                        <span className="flex flex-col items-end min-w-0">
                          <span className={cn("text-xs truncate max-w-full", statusColor)}>
                            {status}
                          </span>
                          {h.booked && visLabel && (
                            <span className="text-[10px] text-muted-foreground/70">
                              {visLabel}
                            </span>
                          )}
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
                      selectable && !picked && "hover:bg-muted/50",
                      selectable && "cursor-pointer"
                    );

                    const daySep = showDaySep ? (
                      <div className="px-3 py-1.5 bg-muted/50 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {dayHeaderLabel(h.startIso)}
                      </div>
                    ) : null;

                    // Slot ter-booking = info saja (siapa & kapan). JANGAN link
                    // ke /session — customer bukan member booking itu → 403.
                    // Slot tersedia → tombol pilih rentang.
                    let rowEl: React.ReactNode;
                    if (h.sessionId) {
                      rowEl = <div className={rowClass}>{inner}</div>;
                    } else if (selectable) {
                      rowEl = (
                        <button
                          type="button"
                          onClick={() => clickSlot(h)}
                          className={rowClass}
                        >
                          {inner}
                        </button>
                      );
                    } else {
                      rowEl = <div className={rowClass}>{inner}</div>;
                    }
                    return (
                      <React.Fragment key={h.startIso}>
                        {daySep}
                        {rowEl}
                      </React.Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No bookings on this date yet.
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              This table is in use. You can only join via an invite link from
              the host.
            </p>
          )}
        </div>

        {/* Footer: tombol booking — muncul saat ada rentang jam terpilih */}
        {selStart && (
          <div className="border-t border-border p-4 sm:p-5 shrink-0">
            <p className="text-xs text-muted-foreground mb-2 text-center">
              Selected: {formatTime(selStart)}–{formatTime(effEnd)}
            </p>
            <Button
              variant="gold"
              size="lg"
              className="w-full"
              disabled={navigating}
              onClick={() => {
                setNavigating(true);
                router.push(
                  `/open-table?tableId=${table.id}&start=${encodeURIComponent(selStart)}&end=${encodeURIComponent(effEnd)}`
                );
              }}
            >
              {navigating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Opening...
                </>
              ) : (
                "Book this time"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
