import {
  requireAdmin,
  getSalesSummary,
  getTopItems,
  getSalesByHour,
  getSalesByDay,
  getPaymentMethods,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/admin";
import { DateRangeFilter } from "./DateRangeFilter";
import { StatCard } from "./components/StatCard";
import { SalesChart } from "./components/SalesChart";
import { TopItemsList } from "./components/TopItemsList";
import { PaymentMethodChart } from "./components/PaymentMethodChart";
import {
  Receipt,
  TrendingUp,
  Users,
  Wallet,
  Utensils,
  Sparkles,
} from "lucide-react";
import { formatIDR } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function AdminOverviewPage({ searchParams }: PageProps) {
  const bar = await requireAdmin();
  const params = await searchParams;
  const range = resolveDateRange(
    (params.range as DateRangePreset) ?? "today",
    params.from,
    params.to
  );

  const [summary, topItems, byHour, byDay, paymentMethods] = await Promise.all([
    getSalesSummary(bar.id, range.from, range.to),
    getTopItems(bar.id, range.from, range.to, 10),
    getSalesByHour(bar.id, range.from, range.to),
    getSalesByDay(bar.id, range.from, range.to),
    getPaymentMethods(bar.id, range.from, range.to),
  ]);

  // Pilih chart yang lebih cocok: kalau 1 hari → by hour, kalau multi-day → by day
  const isMultiDay =
    range.preset !== "today" && range.preset !== "yesterday";

  return (
    <>
      <DateRangeFilter currentLabel={range.label} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stat cards */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Ringkasan
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Omzet"
              value={formatIDR(summary.total_revenue)}
              accent="gold"
            />
            <StatCard
              icon={<Receipt className="h-4 w-4" />}
              label="Transaksi"
              value={summary.transaction_count.toLocaleString("id-ID")}
              sub={
                summary.transaction_count > 0
                  ? `${formatIDR(summary.avg_bill)} / transaksi`
                  : undefined
              }
            />
            <StatCard
              icon={<Users className="h-4 w-4" />}
              label="Pengunjung"
              value={summary.unique_visitors.toLocaleString("id-ID")}
              sub="unique customer"
            />
            <StatCard
              icon={<Utensils className="h-4 w-4" />}
              label="Items"
              value={summary.total_items.toLocaleString("id-ID")}
              sub={
                summary.transaction_count > 0
                  ? `${summary.avg_items_per_transaction} per transaksi`
                  : undefined
              }
            />
          </div>
        </section>

        {/* Sales chart */}
        <section className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {isMultiDay ? "Penjualan per hari" : "Penjualan per jam"}
              </h2>
              <Sparkles className="h-4 w-4 text-primary/50" />
            </div>
            <SalesChart
              data={
                isMultiDay
                  ? byDay.map((d) => ({
                      label: new Date(d.sale_date).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                      }),
                      value: d.total_revenue,
                      count: d.transaction_count,
                    }))
                  : byHour.map((h) => ({
                      label: `${String(h.hour_of_day).padStart(2, "0")}:00`,
                      value: h.total_revenue,
                      count: h.transaction_count,
                    }))
              }
            />
          </div>

          {/* Payment methods */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Metode bayar
              </h2>
              <Wallet className="h-4 w-4 text-primary/50" />
            </div>
            <PaymentMethodChart data={paymentMethods} />
          </div>
        </section>

        {/* Top sellers */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Top 10 item paling laris
            </h2>
            <Utensils className="h-4 w-4 text-primary/50" />
          </div>
          <TopItemsList items={topItems} totalRevenue={summary.total_revenue} />
        </section>
      </div>
    </>
  );
}
