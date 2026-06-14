"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Lock,
  Globe,
  UserPlus,
  UtensilsCrossed,
  Plus,
  Minus,
  X,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { openTable } from "@/lib/actions";
import { formatIDR, getActionErrorMessage, cn } from "@/lib/utils";
import type { TableShape, SessionVisibility } from "@/types/db";
import type { ReservationConfig } from "@/lib/settings-constants";
import type { AvailableSlot } from "@/lib/reservation-format";

interface MenuItemLite {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
}
interface MenuCategoryLite {
  id: string;
  name: string;
  items: MenuItemLite[];
}

interface Props {
  table: {
    id: string;
    label: string;
    shape: TableShape;
    capacity: number;
    min_spend: number;
  };
  areaName: string;
  barName: string;
  barSlug: string;
  reservationConfig: ReservationConfig;
  slots: AvailableSlot[];
  /** ISO slot yang sudah ke-booking reservasi lain (di-disable di picker). */
  bookedSlotIsos?: string[];
  menu: MenuCategoryLite[];
}

const VIBE_OPTIONS = [
  "chill",
  "networking",
  "celebrate",
  "date",
  "after-work",
  "loud",
];

type WaktuMode = "now" | "reservation";

export function OpenTableForm({
  table,
  areaName,
  barSlug,
  reservationConfig,
  slots,
  bookedSlotIsos = [],
  menu,
}: Props) {
  const [title, setTitle] = React.useState("");
  const [visibility, setVisibility] =
    React.useState<SessionVisibility>("public");
  const [vibes, setVibes] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Form ini khusus reservasi customer — selalu mode reservation (pilih slot + DP).
  // Walk-in immediate ada di flow staff/waiter terpisah.
  const waktuMode: WaktuMode = "reservation";
  // Default tanggal = groupKey slot pertama (tanggal paling awal yang tersedia).
  const [selectedDate, setSelectedDate] = React.useState<string>(
    () => slots[0]?.groupKey ?? ""
  );
  const [selectedSlot, setSelectedSlot] = React.useState<string>(""); // jam mulai
  const [selectedEnd, setSelectedEnd] = React.useState<string>(""); // jam selesai

  // Cart order awal: Map<menuItemId, quantity>
  const [cart, setCart] = React.useState<Map<string, number>>(new Map());
  const [menuModalOpen, setMenuModalOpen] = React.useState(false);

  const reservationEnabled = reservationConfig.enabled && slots.length > 0;
  const hasMinSpend = table.min_spend > 0;

  const slotMs = reservationConfig.slotIntervalMinutes * 60 * 1000;
  const bookedSet = React.useMemo(
    () => new Set(bookedSlotIsos),
    [bookedSlotIsos]
  );

  // groupKey mana yang punya slot tersedia (untuk enable/disable di strip).
  const datesWithSlots = React.useMemo(() => {
    const seen = new Set<string>();
    for (const s of slots) seen.add(s.groupKey);
    return seen;
  }, [slots]);

  // Strip tanggal: semua hari dari hari ini sampai booking window.
  // Hari tanpa slot (bar tutup) tetap muncul tapi disabled.
  const windowDates = React.useMemo<DateChip[]>(
    () => buildWindowDates(reservationConfig.bookingWindowDays, datesWithSlots),
    [reservationConfig.bookingWindowDays, datesWithSlots]
  );

  // Slot jam mulai hanya untuk tanggal terpilih.
  const startSlotsForDate = React.useMemo(
    () => slots.filter((s) => s.groupKey === selectedDate),
    [slots, selectedDate]
  );

  // Klik jam: pola "klik mulai → klik selesai".
  // - Belum ada mulai, atau sudah lengkap (mulai+selesai) → set mulai (end kosong).
  // - Sudah ada mulai (end kosong), klik jam SETELAHnya → set selesai.
  // - Klik jam <= mulai → jadikan mulai baru.
  function handleSlotClick(iso: string) {
    const clickedMs = new Date(iso).getTime();
    const startMs = selectedSlot ? new Date(selectedSlot).getTime() : null;

    // Klik tepat di jam mulai yang sedang terpilih → batalkan (uncheck).
    if (startMs !== null && clickedMs === startMs && !selectedEnd) {
      setSelectedSlot("");
      setSelectedEnd("");
      return;
    }
    // Belum ada mulai, atau klik <= mulai → set mulai baru (rentang 1 slot).
    if (startMs === null || clickedMs <= startMs) {
      setSelectedSlot(iso);
      setSelectedEnd("");
      return;
    }
    // Klik setelah mulai → perpanjang/perpendek: selesai = jam diklik + 1 slot.
    // Tiap klik di atas mulai selalu update selesai (tidak reset), jadi bisa
    // bebas memperpanjang ke jam mana pun setelah mulai.
    setSelectedEnd(new Date(clickedMs + slotMs).toISOString());
  }

  // Selesai efektif: kalau user baru klik 1 jam (end kosong), anggap 1 slot.
  const effectiveEnd = React.useMemo(() => {
    if (selectedEnd) return selectedEnd;
    if (selectedSlot)
      return new Date(new Date(selectedSlot).getTime() + slotMs).toISOString();
    return "";
  }, [selectedSlot, selectedEnd, slotMs]);

  // Set ISO slot yang termasuk rentang terpilih [mulai, selesai) untuk highlight.
  const selectedRangeIsos = React.useMemo(() => {
    const set = new Set<string>();
    if (!selectedSlot) return set;
    const startMs = new Date(selectedSlot).getTime();
    const endMs = new Date(effectiveEnd).getTime();
    for (let t = startMs; t < endMs; t += slotMs) {
      set.add(new Date(t).toISOString());
    }
    return set;
  }, [selectedSlot, effectiveEnd, slotMs]);

  // Deteksi bentrok: kalau rentang [mulai, selesai) menabrak slot booked,
  // hitung slot booked pertama yang nabrak → untuk pesan saran.
  const conflict = findConflict(selectedSlot, effectiveEnd, slotMs, bookedSet);

  // Flat menu item lookup
  const itemLookup = React.useMemo(() => {
    const map = new Map<string, MenuItemLite>();
    for (const cat of menu) {
      for (const it of cat.items) map.set(it.id, it);
    }
    return map;
  }, [menu]);

  const cartTotal = React.useMemo(() => {
    let sum = 0;
    for (const [id, qty] of cart) {
      const item = itemLookup.get(id);
      if (item) sum += item.price * qty;
    }
    return sum;
  }, [cart, itemLookup]);

  const cartItemCount = React.useMemo(() => {
    let n = 0;
    for (const qty of cart.values()) n += qty;
    return n;
  }, [cart]);

  // DP calc — hanya untuk reservasi
  const dpRequired =
    waktuMode === "reservation" &&
    reservationConfig.minDownPaymentPercent > 0 &&
    cartTotal > 0;
  const dpAmount = dpRequired
    ? Math.ceil(
        (cartTotal * reservationConfig.minDownPaymentPercent) / 100 / 100
      ) * 100
    : 0;

  // Validasi: min spend
  const minSpendShortfall = hasMinSpend
    ? Math.max(0, table.min_spend - cartTotal)
    : 0;

  // Order awal wajib kalau: min spend ada, ATAU reservasi + DP
  const orderRequired =
    hasMinSpend ||
    (waktuMode === "reservation" &&
      reservationConfig.minDownPaymentPercent > 0);

  function toggleVibe(v: string) {
    setVibes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v].slice(0, 5)
    );
  }

  // Validasi submit
  const canSubmit = React.useMemo(() => {
    if (loading) return false;
    if (!selectedSlot) return false; // minimal 1 jam dipilih
    if (conflict) return false; // rentang nabrak slot booked
    if (orderRequired && cartItemCount === 0) return false;
    if (hasMinSpend && cartTotal < table.min_spend) return false;
    return true;
  }, [
    loading,
    selectedSlot,
    conflict,
    orderRequired,
    cartItemCount,
    hasMinSpend,
    cartTotal,
    table.min_spend,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      const initialOrder = Array.from(cart.entries())
        .filter(([, qty]) => qty > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));

      await openTable({
        tableId: table.id,
        title: title.trim() || undefined,
        visibility,
        vibeTags: vibes,
        reservationAt: selectedSlot || null,
        reservationEndAt: effectiveEnd || null,
        initialOrder: initialOrder.length > 0 ? initialOrder : undefined,
        dpMethod: dpRequired ? "mock" : undefined,
      });
      // openTable redirects on success
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal membuka meja"));
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/bar/${barSlug}`}
            className="text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-medium">
            Buka Meja
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Meja {table.label}</CardTitle>
            <CardDescription className="mt-1">
              {areaName} · {table.shape} · kapasitas {table.capacity}
              {table.min_spend > 0 && ` · min ${formatIDR(table.min_spend)}`}
            </CardDescription>
          </div>
          <Badge variant="default">{table.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Pilih waktu reservasi: tanggal → jam mulai → jam selesai */}
          {reservationEnabled ? (
            <div className="space-y-4">
              {/* Step 1: strip tanggal (kotak hari + tanggal) */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Tanggal
                </label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {windowDates.map((d) => {
                    const active = selectedDate === d.groupKey;
                    return (
                      <button
                        key={d.groupKey}
                        type="button"
                        disabled={!d.hasSlots}
                        onClick={() => {
                          setSelectedDate(d.groupKey);
                          setSelectedSlot("");
                          setSelectedEnd("");
                        }}
                        className={cn(
                          "shrink-0 w-14 py-2 rounded-lg border flex flex-col items-center gap-0.5 transition",
                          !d.hasSlots
                            ? "border-border/40 text-muted-foreground/40 cursor-not-allowed"
                            : active
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                        )}
                      >
                        <span className="text-[10px] font-medium tracking-wide">
                          {d.dayLabel}
                        </span>
                        <span className="text-lg font-semibold leading-none tabular-nums">
                          {d.dateNum}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: list jam multi-select */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Pilih jam
                </label>
                <TimeRangeList
                  slots={startSlotsForDate}
                  rangeIsos={selectedRangeIsos}
                  bookedSet={bookedSet}
                  onClick={handleSlotClick}
                  slotMs={slotMs}
                />
              </div>

              {/* Ringkasan rentang + alert bentrok */}
              {selectedSlot && !conflict && (
                <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
                  Reservasi <strong>{rangeLabel(selectedSlot, effectiveEnd)}</strong>{" "}
                  · {durationHours(selectedSlot, effectiveEnd, slotMs)}
                </div>
              )}
              {conflict && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                  Rentang ini melewati jam{" "}
                  <strong>{conflict.bookedFromLabel}</strong> yang sudah
                  dibooking. Pilih sampai sebelum {conflict.bookedFromLabel},
                  atau mulai dari {conflict.bookedFromLabel} ke atas.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              Reservasi belum tersedia saat ini. Coba lagi nanti atau hubungi bar.
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Judul meja{" "}
              <span className="text-muted-foreground font-normal">
                (opsional)
              </span>
            </label>
            <input
              type="text"
              placeholder="Friday night vibes"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Siapa yang bisa join?
            </label>
            <div className="grid grid-cols-3 gap-2">
              <VisibilityOption
                icon={<Globe className="h-4 w-4" />}
                label="Public"
                desc="Siapa saja"
                active={visibility === "public"}
                onClick={() => setVisibility("public")}
              />
              <VisibilityOption
                icon={<UserPlus className="h-4 w-4" />}
                label="Friends"
                desc="Teman saja"
                active={visibility === "friends"}
                onClick={() => setVisibility("friends")}
              />
              <VisibilityOption
                icon={<Lock className="h-4 w-4" />}
                label="Invite"
                desc="Lewat link"
                active={visibility === "invite_only"}
                onClick={() => setVisibility("invite_only")}
              />
            </div>
          </div>

          {/* Vibes */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Vibe{" "}
              <span className="text-muted-foreground font-normal">(maks 5)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {VIBE_OPTIONS.map((v) => {
                const active = vibes.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleVibe(v)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition",
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Order awal */}
          {menu.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Order awal{" "}
                {orderRequired ? (
                  <span className="text-amber-400 font-normal text-xs">
                    (wajib
                    {hasMinSpend && ` · min ${formatIDR(table.min_spend)}`})
                  </span>
                ) : (
                  <span className="text-muted-foreground font-normal text-xs">
                    (opsional)
                  </span>
                )}
              </label>

              {cartItemCount === 0 ? (
                <button
                  type="button"
                  onClick={() => setMenuModalOpen(true)}
                  className="w-full flex items-center justify-between gap-2 p-3 rounded-md border border-dashed border-border hover:border-primary/50 transition text-sm text-muted-foreground"
                >
                  <span className="flex items-center gap-2">
                    <UtensilsCrossed className="h-4 w-4" />
                    Pilih menu untuk order awal
                  </span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  {/* Cart summary list */}
                  <div className="divide-y divide-border">
                    {Array.from(cart.entries())
                      .filter(([, qty]) => qty > 0)
                      .map(([id, qty]) => {
                        const item = itemLookup.get(id);
                        if (!item) return null;
                        return (
                          <div
                            key={id}
                            className="flex items-center justify-between gap-2 p-2.5 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-primary font-medium mr-1">
                                {qty}×
                              </span>
                              <span className="truncate">{item.name}</span>
                            </div>
                            <span className="tabular-nums text-muted-foreground shrink-0">
                              {formatIDR(item.price * qty)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMenuModalOpen(true)}
                    className="w-full p-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition border-t border-border flex items-center justify-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ubah / tambah order
                  </button>
                </div>
              )}

              {/* Min spend warning */}
              {hasMinSpend && cartTotal > 0 && minSpendShortfall > 0 && (
                <p className="text-xs text-amber-400 mt-1.5">
                  Kurang {formatIDR(minSpendShortfall)} untuk capai minimum
                  spend.
                </p>
              )}
            </div>
          )}

          {/* Summary total + DP */}
          {cartItemCount > 0 && (
            <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total order</span>
                <span className="font-semibold tabular-nums">
                  {formatIDR(cartTotal)}
                </span>
              </div>
              {dpRequired && (
                <div className="flex items-center justify-between text-primary">
                  <span>DP ({reservationConfig.minDownPaymentPercent}%)</span>
                  <span className="font-semibold tabular-nums">
                    {formatIDR(dpAmount)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={!canSubmit}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Memproses...
              </>
            ) : dpRequired ? (
              `Bayar DP ${formatIDR(dpAmount)} & Reservasi`
            ) : (
              "Buat Reservasi"
            )}
          </Button>

          {!canSubmit && !loading && (
            <p className="text-xs text-center text-muted-foreground -mt-2">
              {!selectedSlot
                ? "Pilih jam dulu"
                : orderRequired && cartItemCount === 0
                  ? "Order awal wajib diisi"
                  : hasMinSpend && cartTotal < table.min_spend
                    ? `Belum capai minimum spend ${formatIDR(table.min_spend)}`
                    : ""}
            </p>
          )}
        </form>
      </CardContent>

      {menuModalOpen && (
        <MenuPickerModal
          menu={menu}
          cart={cart}
          onChange={setCart}
          onClose={() => setMenuModalOpen(false)}
        />
      )}
    </Card>
  );
}

// ============================================================
// TIME SELECT — dropdown jam (native select, styled)
// ============================================================

/** Ambil "HH:MM" dari label slot ("Hari ini · 14:00" → "14:00", "14:00" → "14:00"). */
function slotTime(label: string): string {
  return label.split("·")[1]?.trim() ?? label;
}

const HARI_SHORT = ["MIN", "SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];

interface DateChip {
  /** groupKey selaras dengan slot: "today" | "tomorrow" | "YYYY-MM-DD". */
  groupKey: string;
  /** "MIN", "SEN", ... */
  dayLabel: string;
  /** Tanggal angka, mis. 14. */
  dateNum: number;
  /** Ada slot tersedia di hari ini? (kalau tidak → disabled). */
  hasSlots: boolean;
}

/** Bangun strip tanggal dari hari ini sampai N hari (booking window). */
function buildWindowDates(
  windowDays: number,
  datesWithSlots: Set<string>
): DateChip[] {
  const out: DateChip[] = [];
  const now = new Date();
  const total = Math.max(1, windowDays);
  for (let i = 0; i <= total; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    let groupKey: string;
    if (i === 0) groupKey = "today";
    else if (i === 1) groupKey = "tomorrow";
    else
      groupKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({
      groupKey,
      dayLabel: HARI_SHORT[d.getDay()],
      dateNum: d.getDate(),
      hasSlots: datesWithSlots.has(groupKey),
    });
  }
  return out;
}

/**
 * Cek apakah rentang [startIso, endIso) menabrak slot yang sudah dibooking.
 * Return slot booked pertama yang nabrak (untuk pesan), atau null kalau bebas.
 */
function findConflict(
  startIso: string,
  endIso: string,
  slotMs: number,
  bookedSet: Set<string>
): { bookedFromIso: string; bookedFromLabel: string } | null {
  if (!startIso || !endIso) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  for (let t = startMs; t < endMs; t += slotMs) {
    const d = new Date(t);
    const iso = d.toISOString();
    if (bookedSet.has(iso)) {
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return { bookedFromIso: iso, bookedFromLabel: `${hh}:${mm}` };
    }
  }
  return null;
}

/** Label rentang "19:00–22:00" dari ISO mulai+selesai. */
function rangeLabel(startIso: string, endIso: string): string {
  const t = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return `${t(startIso)}–${t(endIso)}`;
}

/** "3 jam" dari rentang. */
function durationHours(startIso: string, endIso: string, slotMs: number): string {
  const n = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / slotMs
  );
  const totalMin = (n * slotMs) / 60000;
  if (totalMin % 60 === 0) return `${totalMin / 60} jam`;
  return `${totalMin} menit`;
}

// ============================================================
// TIME RANGE LIST — list jam multi-select (klik mulai → klik selesai)
// ============================================================

function TimeRangeList({
  slots,
  rangeIsos,
  bookedSet,
  onClick,
  slotMs,
}: {
  slots: AvailableSlot[];
  /** ISO slot yang termasuk rentang terpilih [mulai, selesai) — di-highlight. */
  rangeIsos: Set<string>;
  bookedSet: Set<string>;
  onClick: (iso: string) => void;
  slotMs: number;
}) {
  if (slots.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Tidak ada slot di tanggal ini.
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
      {slots.map((s) => {
        const isBooked = bookedSet.has(s.iso);
        const inRange = rangeIsos.has(s.iso);
        // Label baris = rentang slot ini, mis. "19:00–20:00".
        const endLabel = (() => {
          const d = new Date(new Date(s.iso).getTime() + slotMs);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        })();
        return (
          <button
            key={s.iso}
            type="button"
            disabled={isBooked}
            onClick={() => onClick(s.iso)}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2.5 text-sm transition text-left",
              isBooked
                ? "cursor-not-allowed bg-muted/30"
                : inRange
                  ? "bg-primary/15"
                  : "hover:bg-muted/40"
            )}
          >
            <span
              className={cn(
                "font-medium tabular-nums",
                isBooked
                  ? "text-muted-foreground/50 line-through"
                  : inRange
                    ? "text-primary"
                    : "text-foreground"
              )}
            >
              {slotTime(s.label)}–{endLabel}
            </span>
            {isBooked ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                Dibooking
              </span>
            ) : (
              <span
                className={cn(
                  "text-[11px]",
                  inRange ? "text-primary" : "text-muted-foreground"
                )}
              >
                {inRange ? "Dipilih ✓" : "Tersedia"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// MENU PICKER MODAL (cart lokal, belum ada session)
// ============================================================

function MenuPickerModal({
  menu,
  cart,
  onChange,
  onClose,
}: {
  menu: MenuCategoryLite[];
  cart: Map<string, number>;
  onChange: (next: Map<string, number>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = React.useState<Map<string, number>>(
    () => new Map(cart)
  );
  const [activeCat, setActiveCat] = React.useState(menu[0]?.id ?? "");

  function setQty(id: string, qty: number) {
    setLocal((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }

  const total = React.useMemo(() => {
    let sum = 0;
    for (const cat of menu) {
      for (const it of cat.items) {
        const qty = local.get(it.id) ?? 0;
        sum += it.price * qty;
      }
    }
    return sum;
  }, [local, menu]);

  const itemCount = React.useMemo(() => {
    let n = 0;
    for (const qty of local.values()) n += qty;
    return n;
  }, [local]);

  function handleConfirm() {
    onChange(new Map(local));
    onClose();
  }

  const activeCategory = menu.find((c) => c.id === activeCat) ?? menu[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/85 backdrop-blur-md p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full h-full sm:h-auto sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl sm:max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">Pilih Order Awal</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Category tabs */}
        {menu.length > 1 && (
          <div className="flex gap-1.5 p-3 overflow-x-auto border-b border-border shrink-0">
            {menu.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCat(cat.id)}
                className={cn(
                  "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition",
                  activeCat === cat.id
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* Items list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {activeCategory?.items.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">
              Belum ada menu di kategori ini.
            </p>
          ) : (
            activeCategory?.items.map((item) => {
              const qty = local.get(item.id) ?? 0;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2.5 rounded-md border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {item.name}
                    </div>
                    {item.description && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {item.description}
                      </div>
                    )}
                    <div className="text-xs text-primary font-semibold mt-0.5">
                      {formatIDR(item.price)}
                    </div>
                  </div>
                  {qty === 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQty(item.id, 1)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setQty(item.id, qty - 1)}
                        className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-5 text-center text-sm font-medium tabular-nums">
                        {qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQty(item.id, qty + 1)}
                        className="h-7 w-7 rounded-md border border-primary/40 bg-primary/15 text-primary flex items-center justify-center hover:bg-primary/25"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border shrink-0">
          <Button
            type="button"
            variant="gold"
            size="lg"
            className="w-full"
            onClick={handleConfirm}
            disabled={itemCount === 0}
          >
            {itemCount === 0
              ? "Pilih minimal 1 item"
              : `Konfirmasi · ${itemCount} item · ${formatIDR(total)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SHARED
// ============================================================

function VisibilityOption({
  icon,
  label,
  desc,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 p-3 rounded-md border transition text-center",
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] opacity-70">{desc}</span>
    </button>
  );
}
