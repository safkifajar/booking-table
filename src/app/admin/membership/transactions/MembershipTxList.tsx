"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/admin/Pagination";
import { cn, formatIDR } from "@/lib/utils";
import type { AdminMembershipTxRow } from "@/lib/membership-actions";

type StatusFilter = "all" | "pending" | "paid" | "failed" | "refunded";

const KIND_LABEL: Record<string, string> = {
  purchase: "Purchase",
  renewal: "Renewal",
  admin_grant: "Admin grant",
};

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  refunded: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** List transaksi membership — search + filter status + tabel (pola TransactionsList). */
export function MembershipTxList({ rows }: { rows: AdminMembershipTxRow[] }) {
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return (
        r.id.slice(0, 8).toLowerCase().includes(q) ||
        r.customer_name.toLowerCase().includes(q) ||
        r.customer_email.toLowerCase().includes(q)
      );
    });
  }, [rows, q, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  return (
    <>
      {/* Search ID / customer / email + filter status */}
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
            placeholder="Search transaction ID, customer, or email…"
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v as StatusFilter);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "pending", label: "Pending" },
            { value: "paid", label: "Paid" },
            { value: "failed", label: "Failed" },
            { value: "refunded", label: "Refunded" },
          ]}
          ariaLabel="Filter status"
          className="shrink-0 w-40"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm">No matching membership transactions.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try a different keyword (ID, customer, or email).
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium w-24">ID</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium w-24">Level</th>
                  <th className="px-4 py-3 font-medium w-28">Type</th>
                  <th className="px-4 py-3 font-medium w-24">Status</th>
                  <th className="px-4 py-3 font-medium w-40">Date</th>
                  <th className="px-4 py-3 font-medium w-32">Until</th>
                  <th className="px-4 py-3 font-medium w-36 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageItems.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/membership/transactions/${r.id}`}
                        className="font-mono text-xs text-muted-foreground hover:text-primary transition"
                      >
                        {r.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/users/${r.customer_id}`}
                        className="font-medium hover:text-primary transition block truncate max-w-[220px]"
                      >
                        {r.customer_name}
                      </Link>
                      <span className="text-xs text-muted-foreground block truncate max-w-[220px]">
                        {r.customer_email}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">
                        {r.level_name}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="secondary"
                        className={cn("text-[10px]", STATUS_STYLE[r.status])}
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {fmt(r.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {r.period_end
                        ? new Date(r.period_end).toLocaleDateString("en-US", {
                            dateStyle: "medium",
                          })
                        : "Lifetime"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="font-semibold tabular-nums">
                        {formatIDR(r.amount)}
                      </div>
                      {r.tax_amount + r.service_amount > 0 && (
                        <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                          incl.{" "}
                          {r.tax_amount > 0 && r.service_amount > 0
                            ? "tax & service"
                            : r.tax_amount > 0
                              ? "tax"
                              : "service charge"}{" "}
                          {formatIDR(r.tax_amount + r.service_amount)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Footer: per-page + pagination — selalu tampil (permintaan user) */}
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
            className="w-20"
          />
        </label>
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      </div>
    </>
  );
}
