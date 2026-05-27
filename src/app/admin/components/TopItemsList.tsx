import { formatIDR } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { TopItem } from "@/lib/admin";

export function TopItemsList({
  items,
  totalRevenue,
}: {
  items: TopItem[];
  totalRevenue: number;
}) {
  if (items.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        Belum ada item di menu.
      </div>
    );
  }

  const maxRevenue = Math.max(...items.map((i) => i.total_revenue), 1);

  return (
    <div className="space-y-2">
      {items.map((item, idx) => {
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
            {/* Background bar */}
            {!isUnsold && (
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent"
                style={{ width: `${barWidth}%` }}
              />
            )}
            {/* Content */}
            <div className="relative flex items-center gap-3">
              <span
                className={cn(
                  "w-8 text-xs font-bold shrink-0 tabular-nums",
                  isUnsold ? "text-muted-foreground/60" : "text-primary/70"
                )}
              >
                #{idx + 1}
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
                    <div className="text-sm font-semibold text-primary">
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
