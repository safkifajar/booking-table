"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Search, ArrowRight } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { Pagination } from "@/components/admin/Pagination";
import type { AdminPayment } from "@/lib/admin";

function payId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const METHODS = ["qris", "cash", "card", "gopay", "ovo", "mock"] as const;
const STATUSES = ["paid", "pending", "failed", "refunded"] as const;

/**
 * Status TAMPILAN pembayaran: pending yang QR-nya sudah lewat expiry ditampilkan
 * "cancelled" — sama seperti sisi customer/kasir/waiter (bukan "pending" abadi).
 * failed juga ditampilkan "cancelled".
 */
function displayStatus(p: AdminPayment): string {
  const expired =
    p.status === "pending" &&
    p.expires_at != null &&
    new Date(p.expires_at).getTime() <= Date.now();
  if (p.status === "paid") return "paid";
  if (expired || p.status === "failed") return "cancelled";
  if (p.status === "pending") return "pending";
  return p.status; // refunded, dst
}

function statusBadgeVariant(
  status: string
): "success" | "warning" | "destructive" | "secondary" {
  if (status === "paid") return "success";
  if (status === "pending") return "warning";
  if (status === "cancelled" || status === "failed") return "destructive";
  return "secondary"; // refunded
}

export function PaymentsList({ payments }: { payments: AdminPayment[] }) {
  const [search, setSearch] = React.useState("");
  const [method, setMethod] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    return payments.filter((p) => {
      if (method !== "all" && p.method !== method) return false;
      if (status !== "all" && p.status !== status) return false;
      if (!q) return true;
      return (
        payId(p.id).toLowerCase().includes(q) ||
        p.paid_by_name.toLowerCase().includes(q) ||
        p.table_label.toLowerCase().includes(q)
      );
    });
  }, [payments, q, method, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  if (payments.length === 0) return null;

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search ID, payer, or table…"
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <Select
          value={method}
          onChange={(v) => {
            setMethod(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All methods" },
            ...METHODS.map((m) => ({ value: m, label: m.toUpperCase() })),
          ]}
          className="shrink-0 min-w-[140px]"
          ariaLabel="Filter method"
        />
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All statuses" },
            ...STATUSES.map((s) => ({ value: s, label: s })),
          ]}
          className="shrink-0 min-w-[140px]"
          ariaLabel="Filter status"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm">No matching payments.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try changing your keyword or filters.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Header row (desktop) */}
          <div className="hidden md:grid grid-cols-[90px_1fr_160px_150px_130px_120px_30px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
            <span>ID</span>
            <span>Payer</span>
            <span>Table / Room</span>
            <span>Method</span>
            <span>Time</span>
            <span className="text-right">Amount</span>
            <span></span>
          </div>

          <div className="divide-y divide-border">
            {pageItems.map((p) => (
              <Link
                key={p.id}
                href={`/admin/payments/${p.id}`}
                className="block group hover:bg-muted/30 transition"
              >
                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[90px_1fr_160px_150px_130px_120px_30px] gap-3 px-4 py-3 items-center text-sm">
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    #{payId(p.id)}
                  </span>
                  {/* Payer + untuk order siapa (order meja vs order pribadi) */}
                  <div className="min-w-0 text-sm">
                    <span className="font-medium truncate block">
                      {p.paid_by_name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {p.order_owner_member_id ? "Own order" : "Table bill"}
                    </span>
                  </div>
                  {/* Table / Room — kolom sendiri */}
                  <div className="min-w-0 text-[13px]">
                    <span className="font-medium">Table {p.table_label}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {p.area_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {p.method.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {new Date(p.at).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    <span className="block opacity-70">
                      {new Date(p.at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-primary tabular-nums">
                      {formatIDR(p.amount)}
                    </div>
                    <Badge
                      variant={statusBadgeVariant(displayStatus(p))}
                      className="mt-0.5 text-[9px] px-1.5"
                    >
                      {displayStatus(p)}
                    </Badge>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition" />
                </div>

                {/* Mobile card */}
                <div className="md:hidden p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {p.paid_by_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        Table {p.table_label} · {p.area_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {p.order_owner_member_id ? "Own order" : "Table bill"}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                      #{payId(p.id)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {p.method.toUpperCase()}
                      </Badge>
                      <Badge
                        variant={statusBadgeVariant(displayStatus(p))}
                        className="text-[9px] px-1.5"
                      >
                        {displayStatus(p)}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-primary tabular-nums text-sm">
                        {formatIDR(p.amount)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(p.at).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </div>
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
            <Select
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
              options={[
                { value: "10", label: "10" },
                { value: "25", label: "25" },
                { value: "50", label: "50" },
                { value: "100", label: "100" },
              ]}
              ariaLabel="Per page"
            />
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
