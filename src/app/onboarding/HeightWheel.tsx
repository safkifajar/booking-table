"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Wheel picker tinggi badan (cm) — CMB-style. Nilai tengah = terpilih, item
 * atas/bawah redup. Scroll snap; klik item untuk pilih. Rentang {min..max} cm.
 */
export function HeightWheel({
  value,
  onChange,
  min = 140,
  max = 210,
}: {
  value: number | null;
  onChange: (cm: number) => void;
  min?: number;
  max?: number;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const ITEM_H = 48; // tinggi tiap baris (px) — samakan dgn class h-12
  const values = React.useMemo(
    () => Array.from({ length: max - min + 1 }, (_, i) => min + i),
    [min, max]
  );
  // Nilai default saat belum diisi (fokus scroll ke sini).
  const initial = value ?? 170;
  const snapping = React.useRef(false);

  // Scroll ke nilai terpilih saat mount / value berubah dari luar.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(values.length - 1, initial - min));
    el.scrollTop = idx * ITEM_H;
    // sekali di mount; initial hanya dipakai sbg posisi awal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce: setelah scroll berhenti, snap ke item terdekat & set value.
  const settle = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(values.length - 1, idx));
    const cm = min + clamped;
    if (cm !== value) onChange(cm);
  }, [min, onChange, value, values.length]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const handler = () => {
      if (snapping.current) return;
      clearTimeout(t);
      t = setTimeout(settle, 90);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      clearTimeout(t);
      el.removeEventListener("scroll", handler);
    };
  }, [settle]);

  function scrollToValue(cm: number) {
    const el = scrollRef.current;
    if (!el) return;
    snapping.current = true;
    el.scrollTo({ top: (cm - min) * ITEM_H, behavior: "smooth" });
    onChange(cm);
    setTimeout(() => (snapping.current = false), 300);
  }

  const selected = value ?? initial;

  return (
    <div className="relative mx-auto max-w-xs">
      {/* Garis pemandu tengah (baris terpilih). */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2">
        <div className="mx-6 h-12 rounded-xl border-y border-border" />
      </div>

      <div
        ref={scrollRef}
        className="h-60 overflow-y-auto no-scrollbar snap-y snap-mandatory"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Padding atas & bawah biar item pertama/terakhir bisa ke tengah. */}
        <div style={{ height: 24 * 4 }} aria-hidden />
        {values.map((cm) => {
          const active = cm === selected;
          return (
            <button
              key={cm}
              type="button"
              onClick={() => scrollToValue(cm)}
              className={cn(
                "flex h-12 w-full snap-center items-center justify-center tabular-nums transition",
                active
                  ? "text-2xl font-bold text-foreground"
                  : "text-lg text-muted-foreground/50"
              )}
            >
              {cm} cm
            </button>
          );
        })}
        <div style={{ height: 24 * 4 }} aria-hidden />
      </div>
    </div>
  );
}
