"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Calendar } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";

type Preset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "this_month"
  | "last_month"
  | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
];

/**
 * Hitung [from, to] date YYYY-MM-DD (jakarta timezone) untuk preset.
 * Untuk display di input — to-nya inklusif (bukan eksklusif seperti di resolveDateRange).
 */
function presetToDates(preset: Preset): { from: string; to: string } {
  const TZ_OFFSET_HOURS = 7;
  const nowUtc = new Date();
  const nowJkt = new Date(nowUtc.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);
  const todayJkt = new Date(
    Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), nowJkt.getUTCDate())
  );
  const day = 24 * 60 * 60 * 1000;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  switch (preset) {
    case "today":
      return { from: fmt(todayJkt), to: fmt(todayJkt) };
    case "yesterday": {
      const y = new Date(todayJkt.getTime() - day);
      return { from: fmt(y), to: fmt(y) };
    }
    case "last7":
      return {
        from: fmt(new Date(todayJkt.getTime() - 6 * day)),
        to: fmt(todayJkt),
      };
    case "last30":
      return {
        from: fmt(new Date(todayJkt.getTime() - 29 * day)),
        to: fmt(todayJkt),
      };
    case "this_month": {
      const first = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), 1)
      );
      return { from: fmt(first), to: fmt(todayJkt) };
    }
    case "last_month": {
      const first = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth() - 1, 1)
      );
      const lastDay = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), 0)
      );
      return { from: fmt(first), to: fmt(lastDay) };
    }
    default:
      return { from: "", to: "" };
  }
}

export function DateRangeFilter({
  currentLabel,
  defaultPreset = "today",
}: {
  currentLabel: string;
  /** Preset default halaman (untuk highlight yg benar saat ?range belum di-set). */
  defaultPreset?: Preset;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get("range") as Preset) ?? defaultPreset;
  const customFrom = searchParams.get("from") ?? "";
  const customTo = searchParams.get("to") ?? "";

  // Date input value: kalau preset → derive dari preset, kalau custom → ambil dari URL
  const derivedDates = React.useMemo(() => {
    if (current === "custom") {
      return { from: customFrom, to: customTo };
    }
    return presetToDates(current);
  }, [current, customFrom, customTo]);

  const [fromValue, setFromValue] = React.useState(derivedDates.from);
  const [toValue, setToValue] = React.useState(derivedDates.to);

  // Sync ketika preset/URL berubah dari luar
  React.useEffect(() => {
    setFromValue(derivedDates.from);
    setToValue(derivedDates.to);
  }, [derivedDates.from, derivedDates.to]);

  function setPreset(p: Preset) {
    const params = new URLSearchParams(searchParams);
    params.set("range", p);
    if (p !== "custom") {
      params.delete("from");
      params.delete("to");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyCustom(from: string, to: string) {
    if (!from || !to) return;
    const params = new URLSearchParams(searchParams);
    params.set("range", "custom");
    params.set("from", from);
    params.set("to", to);
    router.push(`${pathname}?${params.toString()}`);
  }

  function onFromChange(value: string) {
    setFromValue(value);
    if (value && toValue) applyCustom(value, toValue);
  }

  function onToChange(value: string) {
    setToValue(value);
    if (fromValue && value) applyCustom(fromValue, value);
  }

  return (
    <div className="sticky top-[57px] z-20 bg-background/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 space-y-2">
        {/* Top row — label + custom date inputs langsung */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <DatePicker
              value={fromValue}
              onChange={onFromChange}
              placeholder="From"
              ariaLabel="Start date"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <DatePicker
              value={toValue}
              onChange={onToChange}
              placeholder="To"
              ariaLabel="End date"
            />
          </div>
        </div>

        {/* Preset chips */}
        <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={cn(
                "shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition",
                current === p.value
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
