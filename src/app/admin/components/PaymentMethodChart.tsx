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

  // Metode yang dipakai produksi hanya: qris, cash, voucher. Sisanya (mock =
  // QRIS via gateway tiruan; card/gopay/ovo tak dipakai) DIGABUNG ke qris —
  // mock memang jalur QRIS. Agregasi di tampilan saja (data DB tak diubah);
  // TOTAL tetap utuh. pct_share dihitung ulang atas grup baru.
  const KEEP = new Set(["cash", "voucher"]);
  const merged = new Map<string, { total_amount: number; payment_count: number }>();
  for (const d of data) {
    const key = KEEP.has(d.method) ? d.method : "qris"; // non-cash/voucher → qris
    const g = merged.get(key) ?? { total_amount: 0, payment_count: 0 };
    g.total_amount += d.total_amount;
    g.payment_count += d.payment_count;
    merged.set(key, g);
  }
  const total = Array.from(merged.values()).reduce(
    (sum, g) => sum + g.total_amount,
    0
  );
  // Urutan tampil: qris, cash, voucher.
  const ORDER = ["qris", "cash", "voucher"];
  const rows: PaymentMethodSummary[] = ORDER.filter((m) => merged.has(m)).map(
    (m) => {
      const g = merged.get(m)!;
      return {
        method: m as PaymentMethodSummary["method"],
        total_amount: g.total_amount,
        payment_count: g.payment_count,
        pct_share: total > 0 ? Math.round((g.total_amount / total) * 1000) / 10 : 0,
      };
    }
  );

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="h-3 rounded-full overflow-hidden flex bg-muted">
        {rows.map((d) => {
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
        {rows.map((d) => {
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
