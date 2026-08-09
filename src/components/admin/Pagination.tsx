"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pagination admin yang seragam (dipakai menu, transaksi, dll).
 * Nomor halaman ringkas dgn ellipsis bila banyak. `page` 0-based.
 */
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages = getPageNumbers(page, totalPages);
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Previous</span>
      </Button>
      <div className="flex items-center gap-1">
        {pages.map((p, i) =>
          p === "..." ? (
            <span
              key={`gap-${i}`}
              className="px-2 text-xs text-muted-foreground"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                "min-w-[32px] h-8 px-2 rounded-md text-xs font-medium border transition tabular-nums",
                p === page
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {p + 1}
            </button>
          )
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages - 1}
        onClick={() => onChange(page + 1)}
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const pages: (number | "...")[] = [];
  const around = new Set<number>([0, total - 1, current - 1, current, current + 1]);
  const sorted = Array.from(around)
    .filter((n) => n >= 0 && n < total)
    .sort((a, b) => a - b);
  let prev = -1;
  for (const n of sorted) {
    if (prev !== -1 && n - prev > 1) pages.push("...");
    pages.push(n);
    prev = n;
  }
  return pages;
}
