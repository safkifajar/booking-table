"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Pagination } from "@/components/admin/Pagination";
import { cn } from "@/lib/utils";
import type { TopItem } from "@/lib/admin";

interface Props {
  items: TopItem[];
  totalRevenue: number;
}

export function ItemsList({ items, totalRevenue }: Props) {
  const [query, setQuery] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState<string | "all">("all");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  // Unique categories dari data
  const categories = React.useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.category_name));
    return Array.from(set).sort();
  }, [items]);

  // Filter berdasar search + kategori
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (activeCategory !== "all" && it.category_name !== activeCategory)
        return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.category_name.toLowerCase().includes(q)
      );
    });
  }, [items, query, activeCategory]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // Hitung rank global biar konsisten (#1 = paling laris keseluruhan, bukan di page)
  // Items prop sudah pre-sorted by rank, jadi index global == rank-1.
  const rankMap = React.useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, idx) => m.set(it.menu_item_id, idx + 1));
    return m;
  }, [items]);

  // Reset ke page 0 saat filter / pageSize berubah
  React.useEffect(() => {
    setPage(0);
  }, [query, activeCategory, pageSize]);

  return (
    <div className="space-y-3">
      {/* Search + category filter */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            className="w-full h-9 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
          <CategoryChip
            label="All"
            count={items.length}
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          />
          {categories.map((c) => {
            const count = items.filter((i) => i.category_name === c).length;
            return (
              <CategoryChip
                key={c}
                label={c}
                count={count}
                active={activeCategory === c}
                onClick={() => setActiveCategory(c)}
              />
            );
          })}
        </div>
      )}

      {/* Result summary */}
      <div className="text-xs text-muted-foreground">
        {filtered.length === items.length ? (
          <>Showing {filtered.length} items</>
        ) : (
          <>
            {filtered.length} of {items.length} items
            {query && <> · search &quot;{query}&quot;</>}
          </>
        )}
      </div>

      {/* List dengan rank global */}
      <ItemsListWithRank
        items={pageItems}
        totalRevenue={totalRevenue}
        rankMap={rankMap}
      />

      {/* Pagination — gaya seragam dgn admin lain */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Per halaman:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
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
              onChange={(p) => {
                setPage(p);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Wrap TopItemsList tapi dengan rank yang fixed (rank global, bukan per page).
 * Untuk simplicity kita panggil TopItemsList dengan items page only, tapi
 * label "#X" akan jadi index per page.
 *
 * Solusi: passing label ke TopItemsList via prop tambahan, atau buat list-nya
 * inline di sini. Saya copy logic-nya supaya bisa pass startRank.
 */
function ItemsListWithRank({
  items,
  totalRevenue,
  rankMap,
}: {
  items: TopItem[];
  totalRevenue: number;
  rankMap: Map<string, number>;
}) {
  if (items.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-md">
        Tidak ada item yang cocok.
      </div>
    );
  }

  // Max revenue dari current page untuk bar width
  const maxRevenue = Math.max(...items.map((i) => i.total_revenue), 1);

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const rank = rankMap.get(item.menu_item_id) ?? 0;
        const pct =
          totalRevenue > 0 ? (item.total_revenue / totalRevenue) * 100 : 0;
        const barWidth =
          item.total_revenue > 0 ? (item.total_revenue / maxRevenue) * 100 : 0;
        const isUnsold = item.total_qty === 0;
        return (
          <div
            key={item.menu_item_id}
            className={cn(
              "relative p-3 rounded-md bg-muted/20 border border-border overflow-hidden",
              isUnsold && "opacity-60"
            )}
          >
            {!isUnsold && (
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent"
                style={{ width: `${barWidth}%` }}
              />
            )}
            <div className="relative flex items-center gap-3">
              <span
                className={cn(
                  "w-10 text-xs font-bold shrink-0 tabular-nums",
                  isUnsold ? "text-muted-foreground/60" : "text-primary/70"
                )}
              >
                #{rank}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {item.category_name}
                  {!isUnsold && (
                    <>
                      {" · "}
                      {item.total_qty} pcs · {item.transaction_count} transaksi
                    </>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                {isUnsold ? (
                  <span className="text-[10px] text-muted-foreground italic">
                    belum terjual
                  </span>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-primary tabular-nums">
                      {formatIDR(item.total_revenue)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pct.toFixed(1)}% share
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatIDR(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition inline-flex items-center gap-1.5",
        active
          ? "bg-primary/15 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "text-[10px] tabular-nums",
          active ? "opacity-80" : "opacity-60"
        )}
      >
        {count}
      </span>
    </button>
  );
}
