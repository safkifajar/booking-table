"use client";

import * as React from "react";
import { Calendar, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";

/**
 * DatePicker general — pengganti <input type="date"> native supaya tampilan
 * konsisten lintas browser/OS. Dipakai di semua tempat yg butuh pilih tanggal.
 *
 * API drop-in mirip input date:
 * - value / onChange pakai string "YYYY-MM-DD" ("" = kosong)
 * - min / max juga "YYYY-MM-DD" (opsional, batasi rentang)
 */

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "YYYY-MM-DD" → {y,m,d} (m 0-based) atau null. Parse tanpa timezone shift. */
function parseISO(v: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return null;
  return { y: +match[1], m: +match[2] - 1, d: +match[3] };
}
function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Bandingkan tanggal (abaikan waktu) via string ISO (aman lexicographically). */
function isBefore(a: string, b: string): boolean {
  return a < b;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "dd/mm/yyyy",
  disabled,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  /**
   * Buka ke ATAS kalau ruang di bawah tak cukup. Tanpa ini kalender terpotong
   * layar saat field berada di bagian bawah halaman (mis. form banner) —
   * tanggalnya tak bisa diklik sama sekali.
   */
  const [dropUp, setDropUp] = React.useState(false);

  const selected = parseISO(value);
  // Bulan yg sedang ditampilkan di kalender (default: tanggal terpilih / hari ini).
  const [view, setView] = React.useState(() => {
    if (selected) return { y: selected.y, m: selected.m };
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });

  // Saat dibuka: sinkronkan view ke tanggal terpilih + tentukan arah buka.
  React.useEffect(() => {
    if (!open) return;
    if (selected) setView({ y: selected.y, m: selected.m });

    // Panel kalender ~360px. Kalau sisa ruang di bawah tombol lebih kecil
    // dari itu DAN ruang di atas lebih lega, buka ke atas.
    const PANEL_H = 360;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setDropUp(spaceBelow < PANEL_H && spaceAbove > spaceBelow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Klik di luar → tutup.
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Format tampilan dd/mm/yyyy (konvensi Indonesia). Nilai yang dikirim ke
  // parent tetap "YYYY-MM-DD" — hanya labelnya yang berubah.
  const label = selected
    ? `${String(selected.d).padStart(2, "0")}/${String(
        selected.m + 1
      ).padStart(2, "0")}/${selected.y}`
    : "";

  function shiftMonth(delta: number) {
    setView((v) => {
      const m = v.m + delta;
      const y = v.y + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      return { y, m: mm };
    });
  }

  function isDisabledDay(iso: string): boolean {
    if (min && isBefore(iso, min)) return true;
    if (max && isBefore(max, iso)) return true;
    return false;
  }

  // Grid: awali dari Minggu sebelum tgl 1, isi 6 baris × 7.
  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: ({ y: number; m: number; d: number; inMonth: boolean })[] = [];
  // hari bulan lalu (grayed)
  const prevDays = new Date(view.y, view.m, 0).getDate();
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = prevDays - i;
    const m = view.m - 1;
    const y = m < 0 ? view.y - 1 : view.y;
    cells.push({ y, m: (m + 12) % 12, d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ y: view.y, m: view.m, d, inMonth: true });
  }
  // isi sisa sampai kelipatan 7 (min 6 baris)
  let nextD = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const m = view.m + 1;
    const y = m > 11 ? view.y + 1 : view.y;
    cells.push({ y, m: m % 12, d: nextD++, inMonth: false });
    if (cells.length >= 42) break;
  }

  const todayISO = (() => {
    const n = new Date();
    return toISO(n.getFullYear(), n.getMonth(), n.getDate());
  })();

  // Rentang tahun untuk dropdown (navigasi cepat). Batas dari min/max kalau ada,
  // else 1900..tahun-max/sekarang. Urut terbaru → lama (praktis utk tgl lahir).
  const yearOptions = React.useMemo(() => {
    const nowY = new Date().getFullYear();
    const minY = min ? parseISO(min)?.y ?? 1900 : 1900;
    const maxY = max ? parseISO(max)?.y ?? nowY : nowY;
    const lo = Math.min(minY, maxY);
    const hi = Math.max(minY, maxY, view.y);
    const out: number[] = [];
    for (let y = hi; y >= lo; y--) out.push(y);
    return out;
  }, [min, max, view.y]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full h-11 px-3 rounded-md bg-input border border-border text-sm text-left flex items-center justify-between focus:outline-none focus:border-primary/60 transition disabled:opacity-50",
          className
        )}
      >
        <span className={cn(!label && "text-muted-foreground")}>
          {label || placeholder}
        </span>
        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 w-[300px] rounded-lg border border-border bg-card p-3 shadow-2xl",
            // Ruang bawah sempit → buka ke atas supaya tak terpotong layar.
            dropUp ? "bottom-full mb-2" : "top-full mt-2"
          )}
        >
          {/* Header: dropdown bulan + tahun (navigasi cepat) + panah bulan */}
          <div className="flex items-center gap-1.5 mb-2">
            <Select
              value={String(view.m)}
              onChange={(v) => setView((s) => ({ ...s, m: +v }))}
              ariaLabel="Month"
              className="flex-1"
              options={MONTHS.map((mn, i) => ({ value: String(i), label: mn }))}
            />
            <Select
              value={String(view.y)}
              onChange={(v) => setView((s) => ({ ...s, y: +v }))}
              ariaLabel="Year"
              className="w-[92px]"
              options={yearOptions.map((y) => ({
                value: String(y),
                label: String(y),
              }))}
            />
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="h-8 w-7 rounded-md hover:bg-muted/60 flex items-center justify-center text-muted-foreground shrink-0"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="h-8 w-7 rounded-md hover:bg-muted/60 flex items-center justify-center text-muted-foreground shrink-0"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="h-7 flex items-center justify-center text-[11px] font-medium text-muted-foreground"
              >
                {w}
              </div>
            ))}
          </div>

          {/* Grid tanggal */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((c, i) => {
              const iso = toISO(c.y, c.m, c.d);
              const isSel = value === iso;
              const isToday = iso === todayISO;
              const dis = isDisabledDay(iso);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={dis}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-9 w-9 mx-auto rounded-md text-sm flex items-center justify-center transition",
                    dis && "text-muted-foreground/30 cursor-not-allowed",
                    !dis && !c.inMonth && "text-muted-foreground/50",
                    !dis && c.inMonth && "text-foreground hover:bg-muted/60",
                    isSel && "bg-primary text-primary-foreground hover:bg-primary",
                    !isSel && isToday && !dis && "ring-1 ring-primary/50"
                  )}
                >
                  {c.d}
                </button>
              );
            })}
          </div>

          {/* Footer: Clear / Today */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border text-sm">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="text-primary hover:underline"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={isDisabledDay(todayISO)}
              onClick={() => {
                onChange(todayISO);
                setOpen(false);
              }}
              className="text-primary hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
