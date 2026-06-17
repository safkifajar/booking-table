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

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.4;
/** Geser pointer > nilai ini (px layar) dihitung sebagai drag, bukan klik. */
const DRAG_THRESHOLD = 6;

/**
 * Interactive SVG floor map. Each table is clickable.
 * Color coding:
 *   - Available (no session): muted with gold border on hover
 *   - Open session: gold filled, pulse animation
 *   - Locked/full: dim with lock badge
 *
 * Zoom/pan: tombol +/−/reset, wheel zoom (desktop), pinch zoom (2 jari),
 * drag untuk geser saat ter-zoom. Klik meja tetap jalan (dibedakan dari drag
 * via threshold pergerakan). Membantu di HP supaya meja bisa diperbesar.
 */
/** viewBox saat ini (unit kanvas). scale = canvasWidth / view.w. */
interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function FloorMap({
  canvasWidth,
  canvasHeight,
  tables,
  selectedTableId,
  onSelectTable,
  highlightTableId,
  className,
}: FloorMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  // view = jendela viewBox yg terlihat. Awal = seluruh kanvas (scale 1).
  const [view, setView] = React.useState<ViewBox>({
    x: 0,
    y: 0,
    w: canvasWidth,
    h: canvasHeight,
  });

  const scale = canvasWidth / view.w;

  // Pointer tracking untuk pan (1 jari) & pinch (2 jari).
  const pointers = React.useRef<Map<number, { x: number; y: number }>>(
    new Map()
  );
  const panStart = React.useRef<{
    px: number;
    py: number;
    view: ViewBox;
    moved: boolean;
    table: FloorMapTable | null;
  } | null>(null);
  const pinchStart = React.useRef<{ dist: number; view: ViewBox } | null>(null);

  /** px layar (relatif container) → satuan kanvas, pakai view sekarang. */
  function pxToCanvas(px: number, py: number, v: ViewBox) {
    const el = containerRef.current;
    const cw = el?.clientWidth || canvasWidth;
    const ch = el?.clientHeight || canvasHeight;
    return { cx: v.x + (px / cw) * v.w, cy: v.y + (py / ch) * v.h };
  }

  /** Clamp view supaya tidak keluar batas kanvas + batasi zoom. */
  function clampView(v: ViewBox): ViewBox {
    const minW = canvasWidth / MAX_SCALE;
    const maxW = canvasWidth; // scale 1 = fit penuh, tidak zoom-out lebih
    let w = Math.min(maxW, Math.max(minW, v.w));
    let h = (w / canvasWidth) * canvasHeight;
    let x = Math.min(Math.max(0, v.x), canvasWidth - w);
    let y = Math.min(Math.max(0, v.y), canvasHeight - h);
    if (w >= canvasWidth) {
      w = canvasWidth;
      h = canvasHeight;
      x = 0;
      y = 0;
    }
    return { x, y, w, h };
  }

  /** Zoom ke faktor tertentu di sekitar titik px (relatif container). */
  function zoomTo(nextScale: number, px: number, py: number) {
    setView((v) => {
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const newW = canvasWidth / s;
      const newH = canvasHeight / s;
      const { cx, cy } = pxToCanvas(px, py, v);
      const el = containerRef.current;
      const cw = el?.clientWidth || canvasWidth;
      const ch = el?.clientHeight || canvasHeight;
      // pertahankan titik (cx,cy) tetap di bawah kursor
      const nx = cx - (px / cw) * newW;
      const ny = cy - (py / ch) * newH;
      return clampView({ x: nx, y: ny, w: newW, h: newH });
    });
  }

  function zoomButton(dir: 1 | -1) {
    const el = containerRef.current;
    zoomTo(
      scale + dir * ZOOM_STEP,
      (el?.clientWidth || canvasWidth) / 2,
      (el?.clientHeight || canvasHeight) / 2
    );
  }

  function resetZoom() {
    setView({ x: 0, y: 0, w: canvasWidth, h: canvasHeight });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const px = rect ? e.clientX - rect.left : 0;
    const py = rect ? e.clientY - rect.top : 0;
    const factor = e.deltaY < 0 ? 1 + ZOOM_STEP / 2 : 1 - ZOOM_STEP / 2;
    zoomTo(scale * factor, px, py);
  }

  function relPoint(e: React.PointerEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: rect ? e.clientX - rect.left : e.clientX,
      y: rect ? e.clientY - rect.top : e.clientY,
    };
  }

  /** Hit-test: meja di titik px layar (relatif container) pakai view sekarang. */
  function tableAt(px: number, py: number): FloorMapTable | null {
    const { cx, cy } = pxToCanvas(px, py, view);
    // iterasi terbalik supaya yg di atas (render terakhir) menang.
    for (let i = tables.length - 1; i >= 0; i--) {
      const t = tables[i];
      if (
        cx >= t.pos_x &&
        cx <= t.pos_x + t.width &&
        cy >= t.pos_y &&
        cy <= t.pos_y + t.height
      ) {
        return t;
      }
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent) {
    // Abaikan pointer yg jatuh di tombol kontrol zoom — kalau di-capture ke
    // container, event-nya ketelan & tombol jadi mati.
    if ((e.target as Element).closest?.("[data-zoom-control]")) return;
    // Capture di CONTAINER supaya pan/pinch tetap mengalir walau jari keluar
    // dari elemen meja. Konsekuensinya event click DOM ketelan — maka SELECT
    // meja dipicu manual di onPointerUp (lihat di bawah), bukan via onClick.
    containerRef.current?.setPointerCapture?.(e.pointerId);
    const p = relPoint(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      pinchStart.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        view,
      };
      panStart.current = null;
    } else if (pointers.current.size === 1) {
      panStart.current = {
        px: p.x,
        py: p.y,
        view,
        moved: false,
        table: tableAt(p.x, p.y),
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = relPoint(e);
    pointers.current.set(e.pointerId, p);

    // Pinch zoom (2 jari)
    if (pinchStart.current && pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const startScale = canvasWidth / pinchStart.current.view.w;
      zoomTo((startScale * dist) / pinchStart.current.dist, midX, midY);
      return;
    }

    // Pan (1 jari, hanya saat ter-zoom)
    if (panStart.current && scale > 1) {
      const el = containerRef.current;
      const cw = el?.clientWidth || canvasWidth;
      const ch = el?.clientHeight || canvasHeight;
      const dxPx = p.x - panStart.current.px;
      const dyPx = p.y - panStart.current.py;
      if (Math.abs(dxPx) > DRAG_THRESHOLD || Math.abs(dyPx) > DRAG_THRESHOLD) {
        panStart.current.moved = true;
      }
      const start = panStart.current.view;
      // geser layar → geser viewBox berlawanan arah, dalam unit kanvas
      const nx = start.x - (dxPx / cw) * start.w;
      const ny = start.y - (dyPx / ch) * start.h;
      setView(clampView({ x: nx, y: ny, w: start.w, h: start.h }));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      // Tap (bukan drag) di atas meja → SELECT. Dipicu di sini, bukan via
      // onClick DOM, karena pointer capture di container menelan click.
      const ps = panStart.current;
      if (ps && !ps.moved && ps.table) {
        onSelectTable?.(ps.table);
      }
      panStart.current = null;
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-border bg-card touch-none select-none",
        className
      )}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="h-auto block w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor: scale > 1 ? "grab" : "pointer" }}
      >
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
          />
        ))}
      </svg>

      {/* Kontrol zoom */}
      <div
        data-zoom-control
        className="absolute bottom-3 right-3 flex flex-col gap-1.5"
      >
        <ZoomBtn label="Perbesar" onClick={() => zoomButton(1)} disabled={scale >= MAX_SCALE - 0.001}>
          +
        </ZoomBtn>
        <ZoomBtn label="Perkecil" onClick={() => zoomButton(-1)} disabled={scale <= MIN_SCALE + 0.001}>
          −
        </ZoomBtn>
        {scale > 1.001 && (
          <ZoomBtn label="Reset zoom" onClick={resetZoom}>
            ⟲
          </ZoomBtn>
        )}
      </div>
    </div>
  );
}

function ZoomBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-9 w-9 rounded-lg border border-border bg-background/90 backdrop-blur-sm text-lg font-semibold text-foreground/80 hover:text-foreground hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center shadow-sm transition touch-auto"
    >
      {children}
    </button>
  );
}

interface TableShapeProps {
  table: FloorMapTable;
  selected: boolean;
  highlighted: boolean;
}

function TableShape({ table, selected, highlighted }: TableShapeProps) {
  const isOpen = !!table.active_session && table.active_session.status === "open";
  const isLocked = !!table.active_session && table.active_session.status === "locked";
  const isReserved = !!table.active_session && table.active_session.status === "reserved";
  // Lewat waktu tapi belum lunas — meja masih terisi, butuh penyelesaian bayar.
  const isOverdue = !!table.active_session && table.active_session.status === "overdue";
  const isAvailable = !table.active_session;

  const fill = isOpen
    ? "rgba(201, 169, 97, 0.25)"
    : isOverdue
      ? "rgba(249, 115, 22, 0.18)"
      : isLocked
        ? "rgba(220, 38, 38, 0.15)"
        : isReserved
          ? "rgba(59, 130, 246, 0.15)"
          : "rgba(28, 28, 28, 0.9)";

  const stroke = selected
    ? "#e6c478"
    : isOpen
      ? "#c9a961"
      : isOverdue
        ? "#f97316"
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
      // pointer-events none: hit-test & select ditangani container via koordinat
      // (onPointerUp). Ini menghindari pointer-capture container menelan event.
      style={{ pointerEvents: "none" }}
      className="transition-opacity"
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
            : isOverdue
              ? "#fb923c"
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
      {table.active_session && !isReserved && !isOverdue && (
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

      {/* Overdue badge — tagihan belum lunas (oranye, tanda seru) */}
      {isOverdue && (
        <g style={{ pointerEvents: "none" }}>
          <circle
            cx={table.pos_x + table.width - 6}
            cy={table.pos_y + 6}
            r="10"
            fill="#f97316"
          />
          <text
            x={table.pos_x + table.width - 6}
            y={table.pos_y + 10}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill="#0a0a0a"
          >
            !
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
