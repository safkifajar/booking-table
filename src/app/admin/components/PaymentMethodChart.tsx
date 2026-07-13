import { formatIDR } from "@/lib/utils";
import type { PaymentMethodSummary } from "@/lib/admin";

const METHOD_COLORS: Record<string, string> = {
  qris: "#e11d2a",
  cash: "#10b981",
  card: "#3b82f6",
  gopay: "#06b6d4",
  ovo: "#a855f7",
  mock: "#a3a3a3",
};

const METHOD_LABELS: Record<string, string> = {
  qris: "QRIS",
  cash: "Cash",
  card: "Card",
  gopay: "GoPay",
  ovo: "OVO",
  mock: "Other",
};

export function PaymentMethodChart({ data }: { data: PaymentMethodSummary[] }) {
  if (data.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        No payments received yet.
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.total_amount, 0);

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="h-3 rounded-full overflow-hidden flex bg-muted">
        {data.map((d) => {
          const color = METHOD_COLORS[d.method] ?? "#999";
          const widthPct = total > 0 ? (d.total_amount / total) * 100 : 0;
          return (
            <div
              key={d.method}
              style={{ width: `${widthPct}%`, background: color }}
              title={`${METHOD_LABELS[d.method] ?? d.method}: ${d.pct_share}%`}
            />
          );
        })}
      </div>

      {/* Legend with values */}
      <div className="space-y-2">
        {data.map((d) => {
          const color = METHOD_COLORS[d.method] ?? "#999";
          const label = METHOD_LABELS[d.method] ?? d.method;
          return (
            <div key={d.method} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: color }}
              />
              <span className="text-xs flex-1 min-w-0 truncate">{label}</span>
              <span className="text-xs text-muted-foreground">
                {d.payment_count}×
              </span>
              <span className="text-xs font-semibold text-primary tabular-nums">
                {d.pct_share}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Grand total */}
      <div className="pt-3 border-t border-border flex justify-between items-center">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          Total
        </span>
        <span className="font-semibold text-primary">{formatIDR(total)}</span>
      </div>
    </div>
  );
}
