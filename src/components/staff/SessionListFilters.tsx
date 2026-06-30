"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Filter bersama untuk daftar sesi di dashboard Waiter & Kasir.
 *
 * Layout: satu baris — tombol [Filter] (buka panel: rentang tanggal + status
 * bayar via dropdown/date input) di kiri, input search di kanan.
 *
 * Generic: bekerja untuk WaiterSessionItem maupun CashierSessionItem selama
 * item memenuhi bentuk minimal `SessionFilterItem`.
 */

export type PayFilter = "all" | "paid" | "unpaid";

/** State filter (selain query) — diangkat ke parent. */
export interface SessionFilterState {
  /** "YYYY-MM-DD" atau "" = tak dibatasi. */
  from: string;
  to: string;
  pay: PayFilter;
}

export const EMPTY_FILTER: SessionFilterState = {
  from: "",
  to: "",
  pay: "all",
};

export interface SessionFilterItem {
  reservation_at: string | null;
  reservation_end_at?: string | null;
  started_at: string;
  outstanding: number;
  subtotal: number;
  host_name: string;
  table_label: string;
  title: string | null;
}

/** Kunci tanggal sesi (reservation_at kalau ada, else started_at) → "YYYY-MM-DD". */
export function sessionDateKeyOf(item: SessionFilterItem): string {
  const d = new Date(item.reservation_at ?? item.started_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Awal & akhir bulan berjalan dlm "YYYY-MM-DD" (default rentang tanggal). */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${y}-${pad(m + 1)}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const last = `${y}-${pad(m + 1)}-${pad(lastDay)}`;
  return { from: first, to: last };
}

/** Cocokkan status bayar item dengan filter. */
function matchPay(item: SessionFilterItem, pay: PayFilter): boolean {
  if (pay === "all") return true;
  if (pay === "paid") return item.outstanding <= 0 && item.subtotal > 0;
  // unpaid
  return item.outstanding > 0;
}

/** Filter daftar item berdasarkan rentang tanggal, query teks, & status bayar. */
export function filterSessions<T extends SessionFilterItem>(
  items: T[],
  { from, to, query, pay }: { from: string; to: string; query: string; pay: PayFilter }
): T[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    const key = sessionDateKeyOf(item); // "YYYY-MM-DD" — aman dibandingkan string
    if (from && key < from) return false;
    if (to && key > to) return false;
    if (!matchPay(item, pay)) return false;
    if (q) {
      const hay = `${item.table_label} ${item.host_name} ${item.title ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const PAY_LABELS: Record<PayFilter, string> = {
  all: "Semua",
  paid: "Lunas",
  unpaid: "Belum lunas",
};

export function SessionListFilters({
  filter,
  onFilter,
  query,
  onQuery,
}: {
  filter: SessionFilterState;
  onFilter: (next: SessionFilterState) => void;
  query: string;
  onQuery: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  // Jumlah filter aktif (tanggal/ status) → badge di tombol.
  const activeCount =
    (filter.from ? 1 : 0) + (filter.to ? 1 : 0) + (filter.pay !== "all" ? 1 : 0);

  return (
    <div className="flex items-center gap-2">
      {/* Tombol Filter + panel melayang (absolute, list tak ikut turun) */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 h-11 px-3.5 rounded-md border text-sm font-medium transition",
            open || activeCount > 0
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-foreground hover:bg-muted/60"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filter
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 bg-primary text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>

        {/* Klik di luar → tutup */}
        {open && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}

        {/* Panel filter — melayang di atas konten, tak mendorong list */}
        {open && (
          <div className="absolute left-0 top-full mt-2 z-50 w-72 rounded-lg border border-border bg-card p-4 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Filter
            </span>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => onFilter(EMPTY_FILTER)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Reset
              </button>
            )}
          </div>

          {/* Status bayar — dropdown */}
          <div>
            <label className="block text-xs font-medium mb-1.5">
              Status Pembayaran
            </label>
            <select
              value={filter.pay}
              onChange={(e) =>
                onFilter({ ...filter, pay: e.target.value as PayFilter })
              }
              className="w-full h-11 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 transition"
            >
              {(["all", "paid", "unpaid"] as PayFilter[]).map((p) => (
                <option key={p} value={p}>
                  {PAY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          {/* Tanggal: range + opsi "Semua tanggal" */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Tanggal</span>
            <button
              type="button"
              onClick={() => onFilter({ ...filter, from: "", to: "" })}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition",
                !filter.from && !filter.to
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/60"
              )}
            >
              Semua tanggal
            </button>
          </div>

          {/* Dari Tanggal */}
          <div>
            <label className="block text-xs font-medium mb-1.5">
              Dari Tanggal
            </label>
            <input
              type="date"
              value={filter.from}
              max={filter.to || undefined}
              onChange={(e) => onFilter({ ...filter, from: e.target.value })}
              className="w-full h-11 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 transition"
            />
          </div>

            {/* Sampai Tanggal */}
            <div>
              <label className="block text-xs font-medium mb-1.5">
                Sampai Tanggal
              </label>
              <input
                type="date"
                value={filter.to}
                min={filter.from || undefined}
                onChange={(e) => onFilter({ ...filter, to: e.target.value })}
                className="w-full h-11 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 transition"
              />
            </div>
          </div>
        )}
      </div>

      {/* Search — tetap satu baris di kanan tombol Filter */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Cari meja, host, atau judul…"
          className="w-full h-11 pl-10 pr-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
        />
      </div>
    </div>
  );
}
