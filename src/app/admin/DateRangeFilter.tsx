"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Calendar, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  { value: "today", label: "Hari ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "last7", label: "7 hari" },
  { value: "last30", label: "30 hari" },
  { value: "this_month", label: "Bulan ini" },
  { value: "last_month", label: "Bulan lalu" },
];

export function DateRangeFilter({ currentLabel }: { currentLabel: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get("range") as Preset) ?? "today";
  const customFrom = searchParams.get("from") ?? "";
  const customTo = searchParams.get("to") ?? "";

  const [showCustom, setShowCustom] = React.useState(current === "custom");
  const [fromValue, setFromValue] = React.useState(customFrom);
  const [toValue, setToValue] = React.useState(customTo);

  function setPreset(p: Preset) {
    const params = new URLSearchParams(searchParams);
    params.set("range", p);
    if (p !== "custom") {
      params.delete("from");
      params.delete("to");
      setShowCustom(false);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyCustom() {
    if (!fromValue || !toValue) return;
    const params = new URLSearchParams(searchParams);
    params.set("range", "custom");
    params.set("from", fromValue);
    params.set("to", toValue);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="sticky top-[57px] z-20 bg-background/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">{currentLabel}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCustom((v) => !v)}
          >
            Custom <ChevronDown className={cn("h-3 w-3 transition", showCustom && "rotate-180")} />
          </Button>
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

        {/* Custom range */}
        {showCustom && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Dari</label>
              <input
                type="date"
                value={fromValue}
                onChange={(e) => setFromValue(e.target.value)}
                className="h-8 px-2 rounded-md bg-input border border-border text-xs focus:outline-none focus:border-primary/60"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Sampai</label>
              <input
                type="date"
                value={toValue}
                onChange={(e) => setToValue(e.target.value)}
                className="h-8 px-2 rounded-md bg-input border border-border text-xs focus:outline-none focus:border-primary/60"
              />
            </div>
            <Button
              size="sm"
              variant="gold"
              disabled={!fromValue || !toValue}
              onClick={applyCustom}
            >
              Apply
            </Button>
            {current === "custom" && (
              <button
                onClick={() => setPreset("today")}
                className="text-xs text-muted-foreground hover:text-foreground p-1"
                aria-label="Clear custom"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
