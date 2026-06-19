"use client";

import * as React from "react";
import { X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet untuk pilih filter hobi & minat (multi-select). Mengikuti pola
 * bottom sheet repo: overlay bg-black/40, muncul dari bawah (rounded-t-2xl),
 * di desktop jadi modal tengah. Pilihan diterapkan saat klik "Terapkan".
 */
export function HobbyFilterSheet({
  open,
  onClose,
  hobbies,
  selected,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  hobbies: string[];
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
              <h2 className="text-sm font-semibold">Filter hobi & minat</h2>
              <p className="text-[11px] text-muted-foreground">
                Pilih satu atau lebih
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Daftar hobi */}
        <div className="flex-1 overflow-y-auto p-4">
          {hobbies.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Belum ada data hobi.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hobbies.map((h) => {
                const on = draft.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => toggle(h)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm border transition",
                      on
                        ? "border-primary bg-primary/15 text-primary font-medium"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70"
                    )}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
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
            Terapkan
            {draft.length > 0 && ` (${draft.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
