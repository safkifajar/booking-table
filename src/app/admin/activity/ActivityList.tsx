"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Search,
  Wallet,
  UtensilsCrossed,
  Armchair,
  ArrowRightLeft,
  UserCircle,
  Settings,
  Activity,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/admin/Pagination";
import { cn } from "@/lib/utils";
import type { ActivityLogRow } from "@/lib/activity-log";

interface Props {
  rows: ActivityLogRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  category: string;
  actorId: string;
  actors: { id: string; name: string; role: string }[];
}

/** Ikon + warna per kategori aksi. */
const CATEGORY_STYLE: Record<
  string,
  { icon: React.ReactNode; cls: string; label: string }
> = {
  payment: {
    icon: <Wallet className="h-3.5 w-3.5" />,
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    label: "Payment",
  },
  order: {
    icon: <UtensilsCrossed className="h-3.5 w-3.5" />,
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    label: "Order",
  },
  session: {
    icon: <Armchair className="h-3.5 w-3.5" />,
    cls: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    label: "Table",
  },
  move: {
    icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
    cls: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    label: "Move",
  },
  customer: {
    icon: <UserCircle className="h-3.5 w-3.5" />,
    cls: "bg-pink-500/15 text-pink-400 border-pink-500/30",
    label: "Customer",
  },
  admin: {
    icon: <Settings className="h-3.5 w-3.5" />,
    cls: "bg-primary/15 text-primary border-primary/30",
    label: "Admin",
  },
};

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export function ActivityList({
  rows,
  total,
  page,
  pageSize,
  query,
  category,
  actorId,
  actors,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [search, setSearch] = React.useState(query);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Rentang baris yang sedang tampil, mis. "21–40 of 137".
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  /** Pertahankan filter tanggal (range/from/to) saat mengubah filter lain. */
  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || v === "all") params.delete(k);
      else params.set(k, String(v));
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="space-y-3">
      {/* Toolbar filter */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pushParams({ q: search, page: 1 });
          }}
          className="relative flex-1 min-w-[200px]"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity or staff name…"
            className="w-full h-10 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </form>

        <Select
          value={category}
          onChange={(v) => pushParams({ category: v, page: 1 })}
          ariaLabel="Filter category"
          className="shrink-0 min-w-[150px]"
          options={[
            { value: "all", label: "All categories" },
            { value: "payment", label: "Payment" },
            { value: "order", label: "Order" },
            { value: "session", label: "Table" },
            { value: "move", label: "Move" },
            { value: "customer", label: "Customer" },
            { value: "admin", label: "Admin" },
          ]}
        />

        <Select
          value={actorId}
          onChange={(v) => pushParams({ actor: v, page: 1 })}
          ariaLabel="Filter staff"
          className="shrink-0 min-w-[160px]"
          options={[
            { value: "", label: "All staff" },
            ...actors.map((a) => ({
              value: a.id,
              label: `${a.name} (${a.role})`,
            })),
          ]}
        />
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Activity className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">No activity found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Try widening the date range or clearing the filters.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium w-44">Time</th>
                  <th className="px-4 py-3 font-medium w-40">Staff</th>
                  <th className="px-4 py-3 font-medium w-36">Category</th>
                  <th className="px-4 py-3 font-medium">Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const s = CATEGORY_STYLE[r.category] ?? {
                    icon: <Activity className="h-3.5 w-3.5" />,
                    cls: "bg-muted text-muted-foreground border-border",
                    label: r.category,
                  };
                  // Kejadian otomatis (gateway/sweep) dibedakan supaya tak
                  // terbaca seolah ada staff yang melakukannya.
                  const isSystem = r.actor_role === "system";
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition">
                      <td
                        className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap align-top"
                        suppressHydrationWarning
                      >
                        {fmtDateTime(r.created_at)}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span
                          className={cn(
                            "font-medium block truncate max-w-[160px]",
                            isSystem && "text-muted-foreground italic"
                          )}
                        >
                          {r.actor_name}
                        </span>
                        {!isSystem && (
                          <span className="text-xs text-muted-foreground">
                            {r.actor_role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                            s.cls
                          )}
                        >
                          {s.icon}
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span className="block">{r.summary}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.action}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Jumlah + page size + pagination (pola halaman admin lain). */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground tabular-nums">
              {rangeStart}–{rangeEnd} of {total}
            </span>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Per page:</span>
              <Select
                value={String(pageSize)}
                // Ganti ukuran halaman → balik ke halaman 1, supaya tak
                // mendarat di halaman yang sudah tak ada.
                onChange={(v) => pushParams({ size: v, page: 1 })}
                options={[
                  { value: "20", label: "20" },
                  { value: "50", label: "50" },
                  { value: "100", label: "100" },
                ]}
                ariaLabel="Per page"
              />
            </label>
          </div>
          {/* Komponen admin memakai index 0-based. */}
          {totalPages > 1 && (
            <Pagination
              page={page - 1}
              totalPages={totalPages}
              onChange={(p) => {
                pushParams({ page: p + 1 });
                if (typeof window !== "undefined") {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
