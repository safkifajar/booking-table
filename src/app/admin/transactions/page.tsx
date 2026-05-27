import Link from "next/link";
import {
  requireAdmin,
  getTransactions,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/admin";
import { DateRangeFilter } from "../DateRangeFilter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt, ArrowRight, Users, Clock } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { ExportButton } from "../components/ExportButton";

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function TransactionsPage({ searchParams }: PageProps) {
  const bar = await requireAdmin();
  const params = await searchParams;
  const range = resolveDateRange(
    (params.range as DateRangePreset) ?? "last7",
    params.from,
    params.to
  );

  const transactions = await getTransactions(bar.id, range.from, range.to, 200);

  // Total summary
  const totalRevenue = transactions.reduce((sum, t) => sum + t.subtotal, 0);

  return (
    <>
      <DateRangeFilter currentLabel={range.label} />

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

        {/* List */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {transactions.map((t) => (
            <Link
              key={t.session_id}
              href={`/admin/transactions/${t.session_id}`}
              className="block group"
            >
              <Card className="p-4 hover:border-primary/40 transition h-full">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="default" className="text-[10px]">
                      {t.table_label}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {t.area_name}
                    </span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
                </div>

                <h3 className="font-medium text-sm truncate mb-1">
                  {t.session_title ?? "Open Table"}
                </h3>
                <p className="text-xs text-muted-foreground truncate mb-3">
                  Host: {t.host_name}
                </p>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {t.member_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {t.duration_minutes}m
                  </span>
                  <span>{t.item_count} items</span>
                </div>

                <div className="pt-3 border-t border-border flex justify-between items-end">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Subtotal
                    </div>
                    <div className="text-sm font-semibold text-primary">
                      {formatIDR(t.subtotal)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(t.closed_at).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      ·{" "}
                      {new Date(t.closed_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
