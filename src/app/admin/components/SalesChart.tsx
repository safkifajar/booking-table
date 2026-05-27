"use client";

import * as React from "react";
import { formatIDR, formatIDRShort } from "@/lib/utils";

interface DataPoint {
  label: string;
  value: number;
  count: number;
}

/**
 * Simple SVG bar chart — no library. Hover shows tooltip with full value.
 * Gold gradient bars on dark bg.
 */
export function SalesChart({ data }: { data: DataPoint[] }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Tidak ada data di periode ini.
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const width = 100; // viewBox 100×100
  const height = 100;
  const barCount = data.length;
  const gap = 1.5;
  const barWidth = (width - gap * (barCount - 1)) / barCount;

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height + 14}`}
        className="w-full h-48 sm:h-56"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="bar-gold" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e6c478" stopOpacity="1" />
            <stop offset="100%" stopColor="#c9a961" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Bars */}
        {data.map((d, i) => {
          const h = (d.value / maxValue) * height;
          const x = i * (barWidth + gap);
          const y = height - h;
          const isHovered = hovered === i;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(h, 0.5)}
                fill="url(#bar-gold)"
                opacity={hovered === null || isHovered ? 1 : 0.55}
                rx={0.5}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{ transition: "opacity 150ms" }}
              />
              {/* invisible wider hit area */}
              <rect
                x={x}
                y={0}
                width={barWidth + gap}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
            </g>
          );
        })}

        {/* X-axis labels — only show subset to avoid clutter */}
        {data.map((d, i) => {
          const showEvery = Math.max(1, Math.ceil(barCount / 8));
          if (i % showEvery !== 0 && i !== barCount - 1) return null;
          const x = i * (barWidth + gap) + barWidth / 2;
          return (
            <text
              key={`label-${i}`}
              x={x}
              y={height + 8}
              textAnchor="middle"
              fontSize="3.5"
              fill="rgba(255,255,255,0.4)"
            >
              {d.label}
            </text>
          );
        })}
      </svg>

      {/* Tooltip below chart */}
      <div className="min-h-[2.5rem] text-xs">
        {hovered !== null && data[hovered] ? (
          <div className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/40 border border-border">
            <span className="text-muted-foreground">{data[hovered].label}</span>
            <div className="text-right">
              <div className="font-semibold text-primary">
                {formatIDR(data[hovered].value)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {data[hovered].count} transaksi
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground text-center">
            Hover bar untuk detail · Max: {formatIDRShort(maxValue)}
          </div>
        )}
      </div>
    </div>
  );
}
