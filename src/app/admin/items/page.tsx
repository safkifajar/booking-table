import {
  requireAdmin,
  getTopItems,
  getSalesSummary,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/admin";
import { DateRangeFilter } from "../DateRangeFilter";
import { TopItemsList } from "../components/TopItemsList";
import { ExportButton } from "../components/ExportButton";
import { Card } from "@/components/ui/card";
import { Utensils, TrendingDown } from "lucide-react";
import { formatIDR } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function ItemsPage({ searchParams }: PageProps) {
  const bar = await requireAdmin();
  const params = await searchParams;
  const range = resolveDateRange(
    (params.range as DateRangePreset) ?? "last30",
    params.from,
    params.to
  );

  const [topItems, allItems, summary] = await Promise.all([
    getTopItems(bar.id, range.from, range.to, 20),
    getTopItems(bar.id, range.from, range.to, 1000),
    getSalesSummary(bar.id, range.from, range.to),
  ]);

  // Worst sellers = bottom 5 (sorted by total_revenue asc)
  const worstItems = [...allItems].sort((a, b) => a.total_revenue - b.total_revenue).slice(0, 5);

  return (
    <>
      <DateRangeFilter currentLabel={range.label} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Utensils className="h-5 w-5 text-primary" />
              Item Performance
            </h2>
            <p className="text-xs text-muted-foreground">
              {allItems.length} item terjual · {formatIDR(summary.total_revenue)} total revenue
            </p>
          </div>
          <ExportButton
            filename={`items-${range.preset}-${new Date().toISOString().split("T")[0]}.csv`}
            rows={allItems.map((i, idx) => ({
              rank: idx + 1,
              name: i.name,
              category: i.category_name,
              qty: i.total_qty,
              revenue: i.total_revenue,
              transactions: i.transaction_count,
              avg_price:
                i.total_qty > 0 ? Math.round(i.total_revenue / i.total_qty) : 0,
            }))}
            headers={[
              "Rank",
              "Nama Item",
              "Kategori",
              "Qty Terjual",
              "Revenue",
              "Transaksi",
              "Avg Price",
            ]}
          />
        </div>

        {/* Top 20 */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Top 20 Best Sellers
          </h3>
          <TopItemsList items={topItems} totalRevenue={summary.total_revenue} />
        </Card>

        {/* Worst sellers */}
        {worstItems.length > 0 && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400 mb-4 flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Bottom 5 (Perlu perhatian)
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Item dengan revenue terendah di periode ini. Pertimbangkan untuk evaluasi
              (drop dari menu, ubah resep, atau promosi).
            </p>
            <div className="space-y-2">
              {worstItems.map((item) => (
                <div
                  key={item.menu_item_id}
                  className="p-3 rounded-md bg-muted/20 border border-border flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {item.category_name} · {item.total_qty} pcs
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-amber-400">
                      {formatIDR(item.total_revenue)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
