"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Filter bersama untuk daftar sesi di dashboard Waiter & Kasir.
 *
 * Generic: bekerja untuk WaiterSessionItem maupun CashierSessionItem selama
 * item memenuhi bentuk minimal `SessionFilterItem`.
 */

export type PayFilter = "all" | "paid" | "unpaid";

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

/**
 * Tanggal unik (sorted) dari item yang berada di bulan & tahun BERJALAN.
 * Dipanggil saat render (client) supaya `new Date()` tidak dievaluasi di
 * module top-level.
 */
export function monthDateKeys(items: SessionFilterItem[]): string[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const set = new Set<string>();
  for (const item of items) {
    const d = new Date(item.reservation_at ?? item.started_at);
    if (d.getFullYear() === y && d.getMonth() === m) {
      set.add(sessionDateKeyOf(item));
    }
  }
  return Array.from(set).sort();
}

/** Cocokkan status bayar item dengan filter. */
function matchPay(item: SessionFilterItem, pay: PayFilter): boolean {
  if (pay === "all") return true;
  if (pay === "paid") return item.outstanding <= 0 && item.subtotal > 0;
  // unpaid
  return item.outstanding > 0;
}

/** Filter daftar item berdasarkan tanggal, query teks, & status bayar. */
export function filterSessions<T extends SessionFilterItem>(
  items: T[],
  {
    dateKey,
    query,
    pay,
  }: { dateKey: string; query: string; pay: PayFilter }
): T[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (dateKey !== "all" && sessionDateKeyOf(item) !== dateKey) return false;
    if (!matchPay(item, pay)) return false;
    if (q) {
      const hay = `${item.table_label} ${item.host_name} ${item.title ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** "22 Jun" — tanggal ringkas (id-ID). */
function fmtDateChip(key: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
  }).format(new Date(key));
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition whitespace-nowrap",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-muted/60"
      )}
    >
      {label}
    </button>
  );
}

export function SessionListFilters({
  dates,
  dateFilter,
  onDateFilter,
  query,
  onQuery,
  pay,
  onPay,
}: {
  dates: string[];
  dateFilter: string;
  onDateFilter: (v: string) => void;
  query: string;
  onQuery: (v: string) => void;
  pay: PayFilter;
  onPay: (v: PayFilter) => void;
}) {
  return (
    <div className="space-y-2">
      {/* Chip tanggal — scroll horizontal */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <Chip
          label="Semua"
          active={dateFilter === "all"}
          onClick={() => onDateFilter("all")}
        />
        {dates.map((d) => (
          <Chip
            key={d}
            label={fmtDateChip(d)}
            active={dateFilter === d}
            onClick={() => onDateFilter(d)}
          />
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Cari meja, host, atau judul…"
          className="w-full h-11 pl-10 pr-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
        />
      </div>

      {/* Chip status bayar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <Chip label="Semua" active={pay === "all"} onClick={() => onPay("all")} />
        <Chip
          label="Lunas"
          active={pay === "paid"}
          onClick={() => onPay("paid")}
        />
        <Chip
          label="Belum lunas"
          active={pay === "unpaid"}
          onClick={() => onPay("unpaid")}
        />
      </div>
    </div>
  );
}
