import {
  requireAdmin,
  getTransactions,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/admin";
import { DateRangeFilter } from "../DateRangeFilter";
import { Card } from "@/components/ui/card";
import { Receipt } from "lucide-react";
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

  const transactions = await getTransactions(bar.id, range.from, range.to, 200);

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
              Transaksi
            </h2>
            <p className="text-xs text-muted-foreground">
              {transactions.length} transaksi · {formatIDR(totalRevenue)} total
            </p>
          </div>
          <ExportButton
            filename={`transactions-${range.preset}-${new Date().toISOString().split("T")[0]}.csv`}
            rows={transactions.map((t) => ({
              date: new Date(t.closed_at).toLocaleString("id-ID"),
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
              "Tanggal",
              "Meja",
              "Area",
              "Host",
              "Judul Sesi",
              "Anggota",
              "Item",
              "Durasi (mnt)",
              "Subtotal",
              "Total Bayar",
            ]}
          />
        </div>

        {/* Empty state */}
        {transactions.length === 0 && (
          <Card className="p-8 text-center border-dashed">
            <Receipt className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm">Belum ada transaksi di periode ini.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Coba pilih rentang tanggal yang lebih lebar.
            </p>
          </Card>
        )}

        {/* List + drawer (client component) */}
        <TransactionsList transactions={transactions} />
      </div>
    </>
  );
}
