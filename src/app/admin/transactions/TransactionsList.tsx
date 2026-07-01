"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Users, Clock, Search } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { Pagination } from "@/components/admin/Pagination";
import type { AdminTransaction } from "@/lib/admin";

/** ID transaksi ringkas dari session_id (8 char pertama, uppercase). */
function txId(sessionId: string): string {
  return sessionId.slice(0, 8).toUpperCase();
}

type StatusFilter = "all" | "paid" | "unpaid";

/** Lunas = tak ada tagihan ATAU sudah terbayar penuh. */
function isPaid(t: AdminTransaction): boolean {
  return t.subtotal === 0 || t.paid_total >= t.subtotal;
}

/** Transaksi masih berjalan (belum ditutup). */
function isActiveTx(t: AdminTransaction): boolean {
  return t.status === "open" || t.status === "locked";
}

export function TransactionsList({
  transactions,
}: {
  transactions: AdminTransaction[];
}) {
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  // Filter by ID transaksi (8 char), label meja, atau nama host + status lunas.
  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    return transactions.filter((t) => {
      if (status === "paid" && !isPaid(t)) return false;
      if (status === "unpaid" && isPaid(t)) return false;
      if (!q) return true;
      return (
        txId(t.session_id).toLowerCase().includes(q) ||
        t.table_label.toLowerCase().includes(q) ||
        t.host_name.toLowerCase().includes(q)
      );
    });
  }, [transactions, q, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clamp page kalau data berubah (mis. ganti filter/search) jadi lebih sedikit.
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  if (transactions.length === 0) return null;

  return (
    <>
      {/* Search by ID / meja / host + filter status */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search transaction ID, table, or host name…"
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setPage(0);
          }}
          className="shrink-0 h-[42px] px-3 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:border-primary/60"
          aria-label="Filter status"
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm">No matching transactions.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try a different keyword (ID, table, or host).
          </p>
        </Card>
      ) : (
      <Card className="overflow-hidden p-0">
        {/* Header row (desktop) */}
        <div className="hidden md:grid grid-cols-[90px_100px_1fr_110px_130px_120px_30px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
          <span>ID</span>
          <span>Table</span>
          <span>Detail</span>
          <span className="text-center">Visitors</span>
          <span>Time</span>
          <span className="text-right">Subtotal</span>
          <span></span>
        </div>

        <div className="divide-y divide-border">
          {pageItems.map((t) => (
            <Link
              key={t.session_id}
              href={`/admin/transactions/${t.session_id}`}
              className="block group hover:bg-muted/30 transition"
            >
              {/* Desktop row */}
              <div className="hidden md:grid grid-cols-[90px_100px_1fr_110px_130px_120px_30px] gap-3 px-4 py-3 items-center text-sm">
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  #{txId(t.session_id)}
                </span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge variant="default" className="text-[10px]">
                    {t.table_label}
                  </Badge>
                  {isActiveTx(t) && (
                    <Badge
                      variant="default"
                      className="text-[9px] px-1.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    >
                      Ongoing
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground truncate">
                    {t.area_name}
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="font-medium truncate text-sm">
                    {t.session_title ?? "Open Table"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Host: {t.host_name} · {t.item_count} items
                  </p>
                </div>

                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {t.member_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {t.duration_minutes}m
                  </span>
                </div>

                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {new Date(t.closed_at ?? t.started_at).toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  <span className="block opacity-70">
                    {new Date(t.closed_at ?? t.started_at).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="text-right">
                  <div className="font-semibold text-primary tabular-nums">
                    {formatIDR(t.subtotal)}
                  </div>
                  {/* subtotal 0 = tak ada tagihan → jangan tampil "belum lunas" */}
                  {t.subtotal === 0 ? null : t.paid_total >= t.subtotal ? (
                    <Badge variant="success" className="mt-0.5 text-[9px] px-1.5">
                      Paid
                    </Badge>
                  ) : (
                    <div className="mt-0.5">
                      <Badge variant="warning" className="text-[9px] px-1.5">
                        Unpaid
                      </Badge>
                      <div className="text-[10px] text-amber-400 tabular-nums">
                        remaining {formatIDR(t.subtotal - t.paid_total)}
                      </div>
                    </div>
                  )}
                </div>

                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition" />
              </div>

              {/* Mobile card */}
              <div className="md:hidden p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="default" className="text-[10px]">
                      {t.table_label}
                    </Badge>
                    {isActiveTx(t) && (
                      <Badge
                        variant="default"
                        className="text-[9px] px-1.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      >
                        Ongoing
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground truncate">
                      {t.area_name}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      #{txId(t.session_id)}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {new Date(t.closed_at ?? t.started_at).toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-sm truncate">
                    {t.session_title ?? "Open Table"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Host: {t.host_name}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {t.member_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {t.duration_minutes}m
                    </span>
                    <span>{t.item_count} items</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-primary tabular-nums text-sm">
                      {formatIDR(t.subtotal)}
                    </div>
                    {t.subtotal === 0 ? null : t.paid_total >= t.subtotal ? (
                      <Badge variant="success" className="mt-0.5 text-[9px] px-1.5">
                        Paid
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="mt-0.5 text-[9px] px-1.5">
                        Unpaid · {formatIDR(t.subtotal - t.paid_total)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Card>
      )}

      {/* Pagination — gaya seragam dgn admin lain */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="h-8 px-2 rounded-md bg-input border border-border text-xs focus:outline-none focus:border-primary"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          {totalPages > 1 && (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              onChange={setPage}
            />
          )}
        </div>
      )}
    </>
  );
}
