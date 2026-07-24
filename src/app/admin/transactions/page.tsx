import {
  requireAdmin,
  getTransactions,
  getPaymentStatusBreakdown,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/admin";
import { DateRangeFilter } from "../DateRangeFilter";
import { Card } from "@/components/ui/card";
import { StatCard } from "../components/StatCard";
import { Receipt, CheckCircle2, AlertCircle } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { ExportButton } from "../components/ExportButton";
import { TransactionsList } from "./TransactionsList";

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function TransactionsPage({ searchParams }: PageProps) {
  const bar = await requireAdmin();
  const params = await searchParams;
  // Default: bulan aktif sekarang (this_month).
  const range = resolveDateRange(
    (params.range as DateRangePreset) ?? "this_month",
    params.from,
    params.to
  );

  const [transactions, payStatus] = await Promise.all([
    getTransactions(bar.id, range.from, range.to, 200),
    getPaymentStatusBreakdown(bar.id, range.from, range.to),
  ]);

  // Total summary
  const totalRevenue = transactions.reduce((sum, t) => sum + t.subtotal, 0);

  return (
    <>
      <DateRangeFilter currentLabel={range.label} defaultPreset="this_month" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              Transactions
            </h2>
            <p className="text-xs text-muted-foreground">
              {transactions.length} transactions · {formatIDR(totalRevenue)} total
            </p>
          </div>
          <ExportButton
            filename={`transactions-${range.preset}-${new Date().toISOString().split("T")[0]}.csv`}
            rows={transactions.map((t) => ({
              id: t.session_id.slice(0, 8).toUpperCase(),
              date: new Date(t.closed_at ?? t.started_at).toLocaleString("en-GB", {
                dateStyle: "short",
                timeStyle: "short",
                hour12: false,
              }),
              table: t.table_label,
              area: t.area_name,
              host: t.host_name,
              title: t.session_title ?? "",
              members: t.member_count,
              items: t.item_count,
              duration_minutes: t.duration_minutes,
              subtotal: t.subtotal,
              paid_total: t.paid_total,
            }))}
            headers={[
              "Transaction ID",
              "Date",
              "Table",
              "Area",
              "Host",
              "Session Title",
              "Members",
              "Items",
              "Duration (min)",
              "Subtotal",
              "Total Paid",
            ]}
          />
        </div>

        {/* Status pembayaran — monitoring lunas vs belum lunas */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Paid"
            value={`${payStatus.paid_count.toLocaleString("en-US")} transactions`}
          />
          <StatCard
            icon={<AlertCircle className="h-4 w-4" />}
            label="Unpaid"
            value={`${payStatus.unpaid_count.toLocaleString("en-US")} transactions`}
          />
        </div>

        {/* Empty state */}
        {transactions.length === 0 && (
          <Card className="p-8 text-center border-dashed">
            <Receipt className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm">No transactions in this period yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try selecting a wider date range.
            </p>
          </Card>
        )}

        {/* List + drawer (client component) */}
        <TransactionsList transactions={transactions} />
      </div>
    </>
  );
}
