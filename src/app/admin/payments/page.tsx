import {
  requireAdmin,
  getPayments,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/admin";
import { DateRangeFilter } from "../DateRangeFilter";
import { Card } from "@/components/ui/card";
import { CreditCard } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { ExportButton } from "../components/ExportButton";
import { PaymentsList } from "./PaymentsList";

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function PaymentsPage({ searchParams }: PageProps) {
  const bar = await requireAdmin();
  const params = await searchParams;
  // Default: bulan aktif sekarang.
  const range = resolveDateRange(
    (params.range as DateRangePreset) ?? "this_month",
    params.from,
    params.to
  );

  const payments = await getPayments(bar.id, range.from, range.to, 500);

  // Summary: total nominal yg benar-benar terbayar (status paid).
  const paidTotal = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <>
      <DateRangeFilter currentLabel={range.label} defaultPreset="this_month" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              Transaksi Pembayaran
            </h2>
            <p className="text-xs text-muted-foreground">
              {payments.length} pembayaran · {formatIDR(paidTotal)} terbayar
            </p>
          </div>
          <ExportButton
            filename={`payments-${range.preset}-${new Date().toISOString().split("T")[0]}.csv`}
            rows={payments.map((p) => ({
              id: p.id.slice(0, 8).toUpperCase(),
              datetime: new Date(p.at).toLocaleString("id-ID"),
              payer: p.paid_by_name,
              table: p.table_label,
              area: p.area_name,
              method: p.method.toUpperCase(),
              status: p.status,
              split_mode: p.split_mode,
              amount: p.amount,
            }))}
            headers={[
              "ID Pembayaran",
              "Waktu",
              "Pembayar",
              "Meja",
              "Area",
              "Metode",
              "Status",
              "Split",
              "Nominal",
            ]}
          />
        </div>

        {/* Empty state */}
        {payments.length === 0 && (
          <Card className="p-8 text-center border-dashed">
            <CreditCard className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm">Belum ada pembayaran di periode ini.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Coba pilih rentang tanggal yang lebih lebar.
            </p>
          </Card>
        )}

        {/* List (client) */}
        <PaymentsList payments={payments} />
      </div>
    </>
  );
}
