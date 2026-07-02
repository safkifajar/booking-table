"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select custom — pengganti <select> native supaya tampilan konsisten & keren
 * (dark-theme, panel melayang, animasi). Dipakai general.
 *
 * API drop-in:
 * - value / onChange(value) pakai string.
 * - options: { value, label }[] (label boleh ReactNode).
 */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
  ariaLabel,
  align = "left",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Alignment panel: "left" (default) atau "right". */
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

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

  // Saat buka, scroll ke item terpilih.
  React.useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.querySelector<HTMLElement>(
        '[data-selected="true"]'
      );
      if (el) el.scrollIntoView({ block: "center" });
    }
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full h-11 px-3 rounded-md bg-input border text-sm text-left flex items-center justify-between gap-2 transition focus:outline-none disabled:opacity-50",
          open ? "border-primary/60" : "border-border hover:border-primary/40"
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className={cn(
            "absolute z-50 mt-1.5 min-w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                data-selected={isSel}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm text-left transition",
                  isSel
                    ? "bg-primary/15 text-primary"
                    : "text-foreground hover:bg-muted/60"
                )}
              >
                <span className="truncate">{o.label}</span>
                {isSel && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
