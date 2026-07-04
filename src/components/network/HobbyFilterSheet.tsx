"use client";

import * as React from "react";
import { X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HobbyGroup } from "@/lib/hobbies";

/**
 * Bottom sheet untuk pilih filter interest (multi-select). Dikelompokkan per
 * kategori + emoji — konsisten dgn katalog interests onboarding/admin. Pilihan
 * diterapkan saat klik "Apply". Nilai = `name` (cocok profiles.hobbies).
 */
export function HobbyFilterSheet({
  open,
  onClose,
  catalog,
  selected,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  catalog: HobbyGroup[];
  selected: string[];
  onApply: (next: string[]) => void;
}) {
  // Draft lokal — baru commit ke parent saat "Terapkan". Diinisialisasi dari
  // `selected`; parent me-remount sheet (via key) tiap dibuka, jadi draft selalu
  // fresh tanpa perlu effect sinkronisasi.
  const [draft, setDraft] = React.useState<string[]>(selected);

  if (!open) return null;

  function toggle(h: string) {
    setDraft((prev) =>
      prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Hobbies & interests filter</h2>
              <p className="text-[11px] text-muted-foreground">
                Select one or more
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Daftar interest per kategori (dgn emoji) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No interests yet.
            </p>
          ) : (
            catalog.map((group) => (
              <div key={group.category}>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 mb-2">
                  {group.category}
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((item) => {
                    const on = draft.includes(item.name);
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => toggle(item.name)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm border transition",
                          on
                            ? "border-primary bg-primary/15 text-primary font-medium"
                            : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70"
                        )}
                      >
                        {item.emoji && (
                          <span aria-hidden className="leading-none">
                            {item.emoji}
                          </span>
                        )}
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer aksi */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={() => setDraft([])}
            disabled={draft.length === 0}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Apply
            {draft.length > 0 && ` (${draft.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
