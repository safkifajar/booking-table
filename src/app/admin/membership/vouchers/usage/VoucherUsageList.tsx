"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/admin/Pagination";
import { cn, formatIDR } from "@/lib/utils";
import type { VoucherUsageRow } from "@/lib/membership-actions";

type StatusFilter = "all" | "used" | "reserved";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Tabel pemakaian voucher — pola sama dgn list transaksi membership. */
export function VoucherUsageList({ rows }: { rows: VoucherUsageRow[] }) {
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (status !== "all" && r.usage_status !== status) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.voucher_name.toLowerCase().includes(q) ||
        r.customer_name.toLowerCase().includes(q) ||
        r.customer_email.toLowerCase().includes(q) ||
        (r.session_id ?? "").slice(0, 8).toLowerCase().includes(q) ||
        (r.table_label ?? "").toLowerCase().includes(q)
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
      {/* Search kode/voucher/customer/transaksi/meja + filter status */}
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
            placeholder="Search voucher code, customer, transaction ID, or table…"
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
            { value: "used", label: "Used" },
            { value: "reserved", label: "Reserved" },
          ]}
          ariaLabel="Filter status"
          className="shrink-0 w-40"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm">No voucher usage yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Rows appear when members redeem vouchers on bill payments.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Voucher</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium w-28 text-right">Discount</th>
                  <th className="px-4 py-3 font-medium w-40">Payment</th>
                  <th className="px-4 py-3 font-medium w-28">Transaction</th>
                  <th className="px-4 py-3 font-medium w-24">Table</th>
                  <th className="px-4 py-3 font-medium w-24">Status</th>
                  <th className="px-4 py-3 font-medium w-40">Used at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageItems.map((r) => (
                  <tr key={r.voucher_id} className="hover:bg-muted/30 transition">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/membership/vouchers/usage/${r.voucher_id}`}
                        className="font-mono text-xs block hover:text-primary transition"
                      >
                        {r.code}
                      </Link>
                      <span className="text-xs text-muted-foreground block truncate max-w-[180px]">
                        {r.voucher_name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/users/${r.customer_id}`}
                        className="font-medium hover:text-primary transition block truncate max-w-[200px]"
                      >
                        {r.customer_name}
                      </Link>
                      <span className="text-xs text-muted-foreground block truncate max-w-[200px]">
                        {r.customer_email}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-primary">
                      {r.discount_applied != null
                        ? formatIDR(r.discount_applied)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.payment_amount != null ? (
                        <>
                          <span className="tabular-nums block">
                            {formatIDR(r.payment_amount)}
                          </span>
                          <span className="text-xs text-muted-foreground block">
                            {r.payment_method} · {r.payment_status}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.session_id ? (
                        <Link
                          href={`/admin/transactions/${r.session_id}`}
                          className="font-mono text-xs text-muted-foreground hover:text-primary transition"
                        >
                          #{r.session_id.slice(0, 8).toUpperCase()}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.table_label ? (
                        <Badge variant="default" className="text-[10px]">
                          {r.table_label}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px]",
                          r.usage_status === "used"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                        )}
                      >
                        {r.usage_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {r.used_at ? fmt(r.used_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Footer: per-page + pagination — selalu tampil */}
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
