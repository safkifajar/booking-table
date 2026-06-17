"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { BarTable, ActiveSessionView } from "@/types/db";

export interface FloorMapTable extends BarTable {
  active_session: ActiveSessionView | null;
}

interface FloorMapProps {
  canvasWidth: number;
  canvasHeight: number;
  tables: FloorMapTable[];
  selectedTableId?: string | null;
  onSelectTable?: (table: FloorMapTable) => void;
  highlightTableId?: string | null;
  className?: string;
}

/**
 * Interactive SVG floor map. Each table is clickable.
 * Color coding:
 *   - Available (no session): muted with gold border on hover
 *   - Open session: gold filled, pulse animation
 *   - Locked/full: dim with lock badge
 */
export function FloorMap({
  canvasWidth,
  canvasHeight,
  tables,
  selectedTableId,
  onSelectTable,
  highlightTableId,
  className,
}: FloorMapProps) {
  // Di HP, kanvas yang lebar dipaksa muat ke layar sempit bikin meja kecil.
  // Solusi: scroll horizontal — SVG diberi lebar minimum (skala lebih besar)
  // di mobile dan bisa digeser kiri-kanan. Di desktop (sm:) min-width dilepas
  // jadi muat penuh seperti biasa. mobileMinWidth ~85% canvas: meja jadi besar
  // tapi denah masih ringkas untuk digeser.
  const mobileMinWidth = Math.round(canvasWidth * 0.85);
  return (
    <div className={cn("relative w-full overflow-x-auto sm:overflow-hidden rounded-xl border border-border bg-card", className)}>
      <svg
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        className="h-auto block w-full max-w-none min-w-[var(--fm-min-w)] sm:min-w-0"
        style={{ ["--fm-min-w" as string]: `${mobileMinWidth}px` }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* subtle grid background */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(201,169,97,0.04)"
              strokeWidth="1"
            />
          </pattern>
          <radialGradient id="open-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#c9a961" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#c9a961" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={canvasWidth} height={canvasHeight} fill="url(#grid)" />

        {tables.map((table) => (
          <TableShape
            key={table.id}
            table={table}
            selected={selectedTableId === table.id}
            highlighted={highlightTableId === table.id}
            onClick={() => onSelectTable?.(table)}
          />
        ))}
      </svg>
    </div>
  );
}

interface TableShapeProps {
  table: FloorMapTable;
  selected: boolean;
  highlighted: boolean;
  onClick: () => void;
}

function TableShape({ table, selected, highlighted, onClick }: TableShapeProps) {
  const isOpen = !!table.active_session && table.active_session.status === "open";
  const isLocked = !!table.active_session && table.active_session.status === "locked";
  const isReserved = !!table.active_session && table.active_session.status === "reserved";
  const isAvailable = !table.active_session;

  const fill = isOpen
    ? "rgba(201, 169, 97, 0.25)"
    : isLocked
      ? "rgba(220, 38, 38, 0.15)"
      : isReserved
        ? "rgba(59, 130, 246, 0.15)"
        : "rgba(28, 28, 28, 0.9)";

  const stroke = selected
    ? "#e6c478"
    : isOpen
      ? "#c9a961"
      : isLocked
        ? "#dc2626"
        : isReserved
          ? "#3b82f6"
          : "rgba(255,255,255,0.15)";

  const strokeWidth = selected || highlighted ? 3 : 2;

  // Center for label
  const cx = table.pos_x + table.width / 2;
  const cy = table.pos_y + table.height / 2;

  return (
    <g
      onClick={onClick}
      className="cursor-pointer transition-opacity hover:opacity-90"
      role="button"
      aria-label={`Table ${table.label}, capacity ${table.capacity}`}
    >
      {/* Glow halo for open sessions — di-render via <g> wrapper supaya
          transform-origin akurat ke (cx, cy), bukan bounding box ellipse. */}
      {isOpen && (
        <g
          style={{ transformOrigin: `${cx}px ${cy}px` }}
          className="table-breathe-glow"
        >
          <ellipse
            cx={cx}
            cy={cy}
            rx={table.width / 2 + 16}
            ry={table.height / 2 + 16}
            fill="url(#open-glow)"
          />
        </g>
      )}

      {/* Main shape */}
      {table.shape === "round" ? (
        <ellipse
          cx={cx}
          cy={cy}
          rx={table.width / 2}
          ry={table.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          className={isOpen ? "table-breathe-shape" : undefined}
          transform={table.rotation ? `rotate(${table.rotation} ${cx} ${cy})` : undefined}
        />
      ) : (
        <rect
          x={table.pos_x}
          y={table.pos_y}
          width={table.width}
          height={table.height}
          rx={table.shape === "booth" ? 16 : 8}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          className={isOpen ? "table-breathe-shape" : undefined}
          transform={table.rotation ? `rotate(${table.rotation} ${cx} ${cy})` : undefined}
        />
      )}

      {/* Label */}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        fill={
          isOpen
            ? "#e6c478"
            : isReserved
              ? "#60a5fa"
              : isAvailable
                ? "#a3a3a3"
                : "#f87171"
        }
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {table.label}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontSize="10"
        fill="rgba(255,255,255,0.4)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {table.capacity} seats
      </text>

      {/* Member count badge for active (open/locked) sessions */}
      {table.active_session && !isReserved && (
        <g style={{ pointerEvents: "none" }}>
          <circle
            cx={table.pos_x + table.width - 6}
            cy={table.pos_y + 6}
            r="10"
            fill="#c9a961"
          />
          <text
            x={table.pos_x + table.width - 6}
            y={table.pos_y + 10}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#0a0a0a"
          >
            {table.active_session.member_count}
          </text>
        </g>
      )}

      {/* Reserved badge — clock icon, no member count yet */}
      {isReserved && (
        <g style={{ pointerEvents: "none" }}>
          <circle
            cx={table.pos_x + table.width - 6}
            cy={table.pos_y + 6}
            r="10"
            fill="#3b82f6"
          />
          <text
            x={table.pos_x + table.width - 6}
            y={table.pos_y + 10}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="#0a0a0a"
          >
            R
          </text>
        </g>
      )}
    </g>
  );
}
