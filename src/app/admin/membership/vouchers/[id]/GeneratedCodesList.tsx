"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/admin/Pagination";
import { cn, formatIDR } from "@/lib/utils";
import type { VoucherTemplateDetail } from "@/lib/membership-actions";

type Instance = VoucherTemplateDetail["instances"][number];
type StatusFilter = "all" | "used" | "reserved" | "active" | "expired";

function statusOf(i: Instance): Exclude<StatusFilter, "all"> {
  if (i.used_at) return "used";
  if (i.reserved) return "reserved";
  if (new Date(i.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

const STATUS_STYLE: Record<string, string> = {
  used: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  reserved: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  active: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  expired: "bg-red-500/15 text-red-400 border-red-500/30",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  });
}

/** Tabel kode voucher yang digenerate dari satu template. */
export function GeneratedCodesList({ instances }: { instances: Instance[] }) {
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    return instances.filter((i) => {
      if (status !== "all" && statusOf(i) !== status) return false;
      if (!q) return true;
      return (
        i.code.toLowerCase().includes(q) ||
        i.member_name.toLowerCase().includes(q) ||
        i.member_email.toLowerCase().includes(q)
      );
    });
  }, [instances, q, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  return (
    <>
      {/* Search kode/member + filter status */}
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
            placeholder="Search code, member, or email…"
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
            { value: "active", label: "Active" },
            { value: "expired", label: "Expired" },
          ]}
          ariaLabel="Filter status"
          className="shrink-0 w-40"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm">No generated codes yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Codes appear automatically when a member&apos;s membership
            activates.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium w-40">Code</th>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium w-40">Generated</th>
                  <th className="px-4 py-3 font-medium w-32">Expires</th>
                  <th className="px-4 py-3 font-medium w-24">Status</th>
                  <th className="px-4 py-3 font-medium w-28 text-right">Discount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageItems.map((i) => {
                  const st = statusOf(i);
                  const linked = st === "used" || st === "reserved";
                  return (
                    <tr key={i.id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-2.5">
                        {linked ? (
                          <Link
                            href={`/admin/membership/vouchers/usage/${i.id}`}
                            className="font-mono text-xs hover:text-primary transition"
                          >
                            {i.code}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs">{i.code}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/users/${i.member_id}`}
                          className="font-medium hover:text-primary transition block truncate max-w-[200px]"
                        >
                          {i.member_name}
                        </Link>
                        <span className="text-xs text-muted-foreground block truncate max-w-[200px]">
                          {i.member_email}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmt(i.generated_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(i.expires_at).toLocaleDateString("en-US", {
                          dateStyle: "medium",
                        })}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="secondary"
                          className={cn("text-[10px]", STATUS_STYLE[st])}
                        >
                          {st}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {i.used_at && i.discount_applied != null ? (
                          <span className="text-primary">
                            {formatIDR(i.discount_applied)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
