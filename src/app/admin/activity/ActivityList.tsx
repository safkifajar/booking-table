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
    icon: <Wallet className="h-4 w-4" />,
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    label: "Payment",
  },
  order: {
    icon: <UtensilsCrossed className="h-4 w-4" />,
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    label: "Order",
  },
  session: {
    icon: <Armchair className="h-4 w-4" />,
    cls: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    label: "Table",
  },
  move: {
    icon: <ArrowRightLeft className="h-4 w-4" />,
    cls: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    label: "Move",
  },
  customer: {
    icon: <UserCircle className="h-4 w-4" />,
    cls: "bg-pink-500/15 text-pink-400 border-pink-500/30",
    label: "Customer",
  },
  admin: {
    icon: <Settings className="h-4 w-4" />,
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
        <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
          {rows.map((r) => {
            const s = CATEGORY_STYLE[r.category] ?? {
              icon: <Activity className="h-4 w-4" />,
              cls: "bg-muted text-muted-foreground border-border",
              label: r.category,
            };
            return (
              <div key={r.id} className="flex items-start gap-3 p-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                    s.cls
                  )}
                  title={s.label}
                >
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "font-medium",
                        // Kejadian otomatis (gateway/sweep) dibedakan supaya tak
                        // terbaca seolah ada staff yang melakukannya.
                        r.actor_role === "system"
                          ? "text-muted-foreground italic"
                          : "text-foreground/80"
                      )}
                    >
                      {r.actor_name}
                    </span>
                    {r.actor_role !== "system" && <> · {r.actor_role}</>} ·{" "}
                    {r.action}
                  </p>
                </div>
                <span
                  className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
                  suppressHydrationWarning
                >
                  {fmtDateTime(r.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination — komponen admin memakai index 0-based. */}
      {totalPages > 1 && (
        <Pagination
          page={page - 1}
          totalPages={totalPages}
          onChange={(p) => pushParams({ page: p + 1 })}
        />
      )}
    </div>
  );
}
