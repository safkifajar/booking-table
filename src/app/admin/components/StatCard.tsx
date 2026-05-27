import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
  deltaPct,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: "gold" | "default";
  /** Persentase perubahan vs periode sebelumnya. null = data baru (∞). */
  deltaPct?: number | null;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 sm:p-5",
        accent === "gold"
          ? "bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border-primary/40"
          : "bg-card border-border"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-primary/60">{icon}</span>}
      </div>
      <div
        className={cn(
          "text-xl sm:text-2xl font-bold truncate",
          accent === "gold" ? "text-gold-gradient" : "text-foreground"
        )}
      >
        {value}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {deltaPct !== undefined && <DeltaBadge pct={deltaPct} />}
        {sub && (
          <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="text-[10px] text-primary/80 font-medium">Baru</span>
    );
  }
  if (pct === 0) {
    return (
      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
        <Minus className="h-2.5 w-2.5" />
        <span>0%</span>
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span
      className={cn(
        "text-[10px] font-semibold inline-flex items-center gap-0.5",
        up ? "text-emerald-400" : "text-red-400"
      )}
    >
      {up ? (
        <TrendingUp className="h-2.5 w-2.5" />
      ) : (
        <TrendingDown className="h-2.5 w-2.5" />
      )}
      <span>
        {up ? "+" : ""}
        {pct}%
      </span>
    </span>
  );
}
