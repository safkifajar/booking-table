"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatGroupKey } from "@/lib/reservation-format";
import type { AvailableSlot } from "@/lib/reservation-format";

/**
 * Picker rentang slot reservasi (strip tanggal + list jam, klik mulai→selesai).
 * Diekstrak dari OpenTableForm supaya dipakai bersama (customer & waiter).
 *
 * Controlled: state mulai/selesai diangkat ke parent via `startIso`/`endIso` +
 * `onChange(startIso, endIso)`. Tanggal terpilih dikelola internal.
 */
export function SlotRangePicker({
  slots,
  bookedSlotIsos = [],
  slotIntervalMinutes,
  bookingWindowDays,
  startIso,
  endIso,
  onChange,
  initialStart,
}: {
  slots: AvailableSlot[];
  bookedSlotIsos?: string[];
  slotIntervalMinutes: number;
  bookingWindowDays: number;
  startIso: string;
  endIso: string;
  onChange: (startIso: string, endIso: string) => void;
  /** Prefill (deep-link) — auto-scroll & set tanggal awal. */
  initialStart?: string;
}) {
  const slotMs = slotIntervalMinutes * 60 * 1000;
  const bookedSet = React.useMemo(
    () => new Set(bookedSlotIsos),
    [bookedSlotIsos]
  );

  const [selectedDate, setSelectedDate] = React.useState<string>(() =>
    initialStart
      ? formatGroupKey(new Date(initialStart), new Date())
      : startIso
        ? formatGroupKey(new Date(startIso), new Date())
        : slots[0]?.groupKey ?? ""
  );

  const datesWithSlots = React.useMemo(() => {
    const seen = new Set<string>();
    for (const s of slots) seen.add(s.groupKey);
    return seen;
  }, [slots]);

  const windowDates = React.useMemo<DateChip[]>(
    () => buildWindowDates(bookingWindowDays, datesWithSlots),
    [bookingWindowDays, datesWithSlots]
  );

  const startSlotsForDate = React.useMemo(
    () => slots.filter((s) => s.groupKey === selectedDate),
    [slots, selectedDate]
  );

  function handleSlotClick(iso: string) {
    const clickedMs = new Date(iso).getTime();
    if (!startIso) {
      onChange(iso, "");
      return;
    }
    const startMs = new Date(startIso).getTime();
    const endMs = endIso ? new Date(endIso).getTime() : startMs + slotMs;

    if (clickedMs >= startMs && clickedMs < endMs) {
      if (clickedMs === startMs) {
        const newStart = startMs + slotMs;
        if (newStart >= endMs) onChange("", "");
        else onChange(new Date(newStart).toISOString(), endIso);
        return;
      }
      onChange(startIso, iso);
      return;
    }
    if (clickedMs < startMs) {
      onChange(iso, "");
      return;
    }
    onChange(startIso, new Date(clickedMs + slotMs).toISOString());
  }

  const effectiveEnd = React.useMemo(() => {
    if (endIso) return endIso;
    if (startIso)
      return new Date(new Date(startIso).getTime() + slotMs).toISOString();
    return "";
  }, [startIso, endIso, slotMs]);

  const selectedRangeIsos = React.useMemo(() => {
    const set = new Set<string>();
    if (!startIso) return set;
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(effectiveEnd).getTime();
    for (let t = startMs; t < endMs; t += slotMs) {
      set.add(new Date(t).toISOString());
    }
    return set;
  }, [startIso, effectiveEnd, slotMs]);

  const conflict = findConflict(startIso, effectiveEnd, slotMs, bookedSet);

  return (
    <div className="space-y-4">
      {/* Strip tanggal */}
      <div>
        <label className="block text-sm font-medium mb-2">Tanggal</label>
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
                  onChange("", "");
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

      {/* List jam */}
      <div>
        <label className="block text-sm font-medium mb-2">Pilih jam</label>
        <TimeRangeList
          slots={startSlotsForDate}
          rangeIsos={selectedRangeIsos}
          bookedSet={bookedSet}
          onClick={handleSlotClick}
          slotMs={slotMs}
          scrollToIso={initialStart}
        />
      </div>

      {/* Ringkasan + konflik */}
      {startIso && !conflict && (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
          Reservasi <strong>{rangeLabel(startIso, effectiveEnd)}</strong> ·{" "}
          {durationHours(startIso, effectiveEnd, slotMs)}
        </div>
      )}
      {conflict && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
          Rentang ini melewati jam <strong>{conflict.bookedFromLabel}</strong>{" "}
          yang sudah dibooking. Pilih sampai sebelum {conflict.bookedFromLabel},
          atau mulai dari {conflict.bookedFromLabel} ke atas.
        </div>
      )}
    </div>
  );
}

// ============================================================
// Helpers (dipindah dari OpenTableForm)
// ============================================================

function slotTime(label: string): string {
  return label.split("·")[1]?.trim() ?? label;
}

const HARI_SHORT = ["MIN", "SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];

interface DateChip {
  groupKey: string;
  dayLabel: string;
  dateNum: number;
  hasSlots: boolean;
}

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

function rangeLabel(startIso: string, endIso: string): string {
  const t = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return `${t(startIso)}–${t(endIso)}`;
}

function durationHours(startIso: string, endIso: string, slotMs: number): string {
  const n = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / slotMs
  );
  const totalMin = (n * slotMs) / 60000;
  if (totalMin % 60 === 0) return `${totalMin / 60} jam`;
  return `${totalMin} menit`;
}

function TimeRangeList({
  slots,
  rangeIsos,
  bookedSet,
  onClick,
  slotMs,
  scrollToIso,
}: {
  slots: AvailableSlot[];
  rangeIsos: Set<string>;
  bookedSet: Set<string>;
  onClick: (iso: string) => void;
  slotMs: number;
  scrollToIso?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const targetRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (scrollToIso && targetRef.current && containerRef.current) {
      containerRef.current.scrollTop =
        targetRef.current.offsetTop - containerRef.current.offsetTop;
    }
  }, [scrollToIso]);

  if (slots.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Tidak ada slot di tanggal ini.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border"
    >
      {slots.map((s) => {
        const isBooked = bookedSet.has(s.iso);
        const inRange = rangeIsos.has(s.iso);
        const isTarget = s.iso === scrollToIso;
        const endLabel = (() => {
          const d = new Date(new Date(s.iso).getTime() + slotMs);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        })();
        return (
          <button
            key={s.iso}
            ref={isTarget ? targetRef : undefined}
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
