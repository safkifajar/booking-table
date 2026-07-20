"use client";

import * as React from "react";
import { formatIDR, formatIDRShort } from "@/lib/utils";

interface DataPoint {
  label: string;
  value: number;
  count: number;
}

/**
 * Bar chart pakai HTML+flexbox (bukan SVG) supaya text labels
 * tidak distorsi & responsive. Hover di bar tampilkan tooltip.
 */
export function SalesChart({ data }: { data: DataPoint[] }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No data for this period.
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  // Tentukan stride label supaya tidak overlap.
  // Asumsi tiap label butuh sekitar 60px lebar layar.
  // Untuk >= 24 data points, kita show every 3rd; >= 16 every 2nd; else all.
  const labelStride =
    data.length >= 24 ? 4 : data.length >= 16 ? 3 : data.length >= 10 ? 2 : 1;

  return (
    <div className="space-y-3">
      {/* Bars */}
      <div className="relative h-44 sm:h-52 flex items-end gap-[2px] overflow-hidden">
        {data.map((d, i) => {
          const h = (d.value / maxValue) * 100;
          const isHovered = hovered === i;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              className="group relative flex-1 h-full flex flex-col justify-end transition-opacity"
              style={{
                opacity: hovered === null || isHovered ? 1 : 0.55,
              }}
              aria-label={`${d.label}: ${formatIDR(d.value)}, ${d.count} transaksi`}
            >
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${Math.max(h, 0.5)}%`,
                  background:
                    "linear-gradient(180deg, #ff4d57 0%, #e11d2a 60%, rgba(225, 29, 42,0.55) 100%)",
                  boxShadow: isHovered
                    ? "0 0 12px rgba(225, 29, 42,0.5)"
                    : "none",
                }}
              />
            </button>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-[2px]">
        {data.map((d, i) => {
          const showLabel =
            i % labelStride === 0 || i === data.length - 1;
          return (
            <div
              key={`label-${i}`}
              className="flex-1 text-center text-[10px] text-muted-foreground whitespace-nowrap overflow-hidden"
            >
              {showLabel ? d.label : ""}
            </div>
          );
        })}
      </div>

      {/* Tooltip / footer */}
      <div className="min-h-[2.5rem] text-xs">
        {hovered !== null && data[hovered] ? (
          <div className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/40 border border-border">
            <span className="text-muted-foreground">{data[hovered].label}</span>
            <div className="text-right">
              <div className="font-semibold text-primary tabular-nums">
                {formatIDR(data[hovered].value)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {data[hovered].count} transaksi
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground text-center">
            Hover bar for detail · Max: {formatIDRShort(maxValue)}
          </div>
        )}
      </div>
    </div>
  );
}
