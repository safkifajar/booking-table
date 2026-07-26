import {
  requireAdmin,
  getSummaryWithDelta,
  getTopItems,
  getTopCustomers,
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
import { TopCustomersList } from "./components/TopCustomersList";
import { PaymentMethodChart } from "./components/PaymentMethodChart";
import {
  Receipt,
  TrendingUp,
  TrendingDown,
  Users,
  Wallet,
  Utensils,
  Minus,
  UserRound,
} from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { Crown } from "lucide-react";
import { getMembershipStats } from "@/lib/membership-actions";

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function AdminOverviewPage({ searchParams }: PageProps) {
  const bar = await requireAdmin();
  const params = await searchParams;
  const range = resolveDateRange(
    (params.range as DateRangePreset) ?? "this_month",
    params.from,
    params.to
  );

  const membershipStats = await getMembershipStats();
  const [summary, topItems, topCustomers, byHour, byDay, paymentMethods] =
    await Promise.all([
      getSummaryWithDelta(bar.id, range.from, range.to),
      getTopItems(bar.id, range.from, range.to, 10),
      getTopCustomers(bar.id, range.from, range.to, 10),
      getSalesByHour(bar.id, range.from, range.to),
      getSalesByDay(bar.id, range.from, range.to),
      getPaymentMethods(bar.id, range.from, range.to),
    ]);

  // Pilih chart yang lebih cocok: kalau 1 hari → by hour, kalau multi-day → by day
  const isMultiDay =
    range.preset !== "today" && range.preset !== "yesterday";

  // Build full-grid chart data — fill missing slots dengan 0 supaya visual rapi
  const chartData: { label: string; value: number; count: number }[] = [];
  if (isMultiDay) {
    const fromDate = new Date(range.from);
    const toDate = new Date(range.to);
    const dayMs = 24 * 60 * 60 * 1000;
    const fmtDate = (d: Date) =>
      new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const byDayMap = new Map(byDay.map((d) => [d.sale_date, d]));
    for (let t = fromDate.getTime(); t < toDate.getTime(); t += dayMs) {
      const dayKey = fmtDate(new Date(t));
      const found = byDayMap.get(dayKey);
      chartData.push({
        label: new Date(t).toLocaleDateString("en-US", {
          day: "numeric",
          month: "short",
        }),
        value: found?.total_revenue ?? 0,
        count: found?.transaction_count ?? 0,
      });
    }
  } else {
    // Jam operasional bar: 16:00 sampai 03:00 (12 slot)
    const operatingHours = [16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3];
    const byHourMap = new Map(byHour.map((h) => [h.hour_of_day, h]));
    for (const h of operatingHours) {
      const found = byHourMap.get(h);
      chartData.push({
        label: `${String(h).padStart(2, "0")}:00`,
        value: found?.total_revenue ?? 0,
        count: found?.transaction_count ?? 0,
      });
    }
  }

  return (
    <>
      <DateRangeFilter currentLabel={range.label} defaultPreset="this_month" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Hero Net Sales card */}
        <NetSalesHero
          revenue={summary.total_revenue}
          deltaPct={summary.delta_revenue_pct}
          prevRevenue={summary.prev.total_revenue}
          rangeLabel={range.label}
        />

        {/* Stat cards row 2 — sub metrics */}
        <section>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard
              icon={<Receipt className="h-4 w-4" />}
              label="Transactions"
              value={summary.transaction_count.toLocaleString("en-US")}
              sub={
                summary.transaction_count > 0
                  ? `${formatIDR(summary.avg_bill)} / transaction`
                  : undefined
              }
              deltaPct={summary.delta_transaction_pct}
            />
            <StatCard
              icon={<Users className="h-4 w-4" />}
              label="Visitors"
              value={summary.unique_visitors.toLocaleString("en-US")}
              sub="unique customers"
              deltaPct={summary.delta_visitors_pct}
            />
            <StatCard
              icon={<Utensils className="h-4 w-4" />}
              label="Items sold"
              value={summary.total_items.toLocaleString("en-US")}
              sub={
                summary.transaction_count > 0
                  ? `${summary.avg_items_per_transaction} per transaction`
                  : undefined
              }
            />
          </div>
        </section>

        {/* Membership — member per level (efektif) + revenue 30 hari */}
        <section>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<Crown className="h-4 w-4" />}
              label="Basic"
              value={membershipStats.counts.basic.toLocaleString("en-US")}
              sub="members"
            />
            <StatCard
              icon={<Crown className="h-4 w-4" />}
              label="Premium"
              value={membershipStats.counts.premium.toLocaleString("en-US")}
              sub="members"
            />
            <StatCard
              icon={<Crown className="h-4 w-4" />}
              label="VIP"
              value={membershipStats.counts.vip.toLocaleString("en-US")}
              sub="members"
            />
            <StatCard
              icon={<Crown className="h-4 w-4" />}
              label="Membership revenue"
              value={formatIDR(membershipStats.revenue_30d)}
              sub="last 30 days"
            />
          </div>
        </section>

        {/* Sales chart + Payment methods */}
        <section className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">
                  {isMultiDay ? "Sales per day" : "Sales per hour"}
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {isMultiDay
                    ? `${chartData.length} days · ${range.label.toLowerCase()}`
                    : "Operating hours 16:00 — 03:00"}
                </p>
              </div>
            </div>
            <SalesChart data={chartData} />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Payment methods</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Money received per method
                </p>
              </div>
              <Wallet className="h-4 w-4 text-primary/50" />
            </div>
            <PaymentMethodChart data={paymentMethods} />
          </div>
        </section>

        {/* Top sellers (kiri) + Pelanggan sering datang (kanan) */}
        <section className="grid lg:grid-cols-2 gap-4 items-start">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Top 10 best sellers</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Based on revenue for this period
                </p>
              </div>
              <Utensils className="h-4 w-4 text-primary/50" />
            </div>
            <TopItemsList
              items={topItems}
              totalRevenue={summary.total_revenue}
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Top 10 loyal customers</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Most frequent visitors this period
                </p>
              </div>
              <UserRound className="h-4 w-4 text-primary/50" />
            </div>
            <TopCustomersList customers={topCustomers} />
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * Hero card untuk Net Sales — angka besar dominan + delta indicator.
 */
function NetSalesHero({
  revenue,
  deltaPct,
  prevRevenue,
  rangeLabel,
}: {
  revenue: number;
  deltaPct: number | null;
  prevRevenue: number;
  rangeLabel: string;
}) {
  return (
    <section className="relative rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent p-6 sm:p-8 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(225, 29, 42,0.18),transparent_60%)] pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] uppercase tracking-widest text-primary/80 font-semibold">
            Net Sales · {rangeLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="text-4xl sm:text-5xl font-bold text-gold-gradient tabular-nums">
            {formatIDR(revenue)}
          </div>
          <HeroDelta pct={deltaPct} prev={prevRevenue} />
        </div>
      </div>
    </section>
  );
}

function HeroDelta({ pct, prev }: { pct: number | null; prev: number }) {
  if (pct === null) {
    return (
      <div className="text-xs text-primary/80">
        First sales in this period
      </div>
    );
  }
  if (pct === 0) {
    return (
      <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Minus className="h-3 w-3" />
        Same as previous period
      </div>
    );
  }
  const up = pct > 0;
  return (
    <div
      className={`text-sm font-semibold inline-flex items-center gap-1 ${
        up ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {up ? (
        <TrendingUp className="h-4 w-4" />
      ) : (
        <TrendingDown className="h-4 w-4" />
      )}
      <span>
        {up ? "+" : ""}
        {pct}%
      </span>
      <span className="text-muted-foreground font-normal">
        vs {formatIDR(prev)} last period
      </span>
    </div>
  );
}
