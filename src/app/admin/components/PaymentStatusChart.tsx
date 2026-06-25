import { formatIDR } from "@/lib/utils";
import type { PaymentStatusBreakdown } from "@/lib/admin";

/**
 * Proporsi transaksi Lunas vs Belum Lunas (by jumlah transaksi).
 * Gaya stacked-bar + legend, konsisten dgn PaymentMethodChart.
 */
export function PaymentStatusChart({ data }: { data: PaymentStatusBreakdown }) {
  const totalCount = data.paid_count + data.unpaid_count;

  if (totalCount === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        Belum ada transaksi di periode ini.
      </div>
    );
  }

  const paidPct = Math.round((data.paid_count / totalCount) * 100);
  const unpaidPct = 100 - paidPct;

  const rows = [
    {
      key: "paid",
      label: "Lunas",
      color: "#10b981",
      count: data.paid_count,
      pct: paidPct,
      amount: data.paid_revenue,
    },
    {
      key: "unpaid",
      label: "Belum lunas",
      color: "#ef4444",
      count: data.unpaid_count,
      pct: unpaidPct,
      amount: data.unpaid_billed,
    },
  ];

  return (
    <div className="space-y-3">
      {/* Stacked bar (by jumlah transaksi) */}
      <div className="h-3 rounded-full overflow-hidden flex bg-muted">
        {rows.map((r) => (
          <div
            key={r.key}
            style={{ width: `${r.pct}%`, background: r.color }}
            title={`${r.label}: ${r.pct}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: r.color }}
            />
            <span className="text-xs flex-1 min-w-0 truncate">{r.label}</span>
            <span className="text-xs text-muted-foreground">{r.count}×</span>
            <span className="text-xs font-semibold text-primary tabular-nums">
              {r.pct}%
            </span>
          </div>
        ))}
      </div>

      {/* Sisa yg belum dibayar (utk nagih) — beda dgn nilai tagihan di atas */}
      <div className="pt-3 border-t border-border flex justify-between items-center">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          Belum tertagih
        </span>
        <span className="font-semibold text-red-400">
          {formatIDR(data.unpaid_outstanding)}
        </span>
      </div>
    </div>
  );
}
