import {
  requireAdmin,
  getAllItemsPerformance,
  getSalesSummary,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/admin";
import { DateRangeFilter } from "../DateRangeFilter";
import { ExportButton } from "../components/ExportButton";
import { ItemsList } from "./ItemsList";
import { Card } from "@/components/ui/card";
import { Utensils } from "lucide-react";
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

  const [allItems, summary] = await Promise.all([
    getAllItemsPerformance(bar.id, range.from, range.to),
    getSalesSummary(bar.id, range.from, range.to),
  ]);

  const soldCount = allItems.filter((i) => i.total_qty > 0).length;

  return (
    <>
      <DateRangeFilter currentLabel={range.label} defaultPreset="last30" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Utensils className="h-5 w-5 text-primary" />
              Item Performance
            </h2>
            <p className="text-xs text-muted-foreground">
              {soldCount} dari {allItems.length} item terjual ·{" "}
              {formatIDR(summary.total_revenue)} total revenue
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

        {/* Full list dengan pagination + search + filter kategori */}
        <Card className="p-5">
          <ItemsList items={allItems} totalRevenue={summary.total_revenue} />
        </Card>
      </div>
    </>
  );
}
