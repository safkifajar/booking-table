import { cn } from "@/lib/utils";

export function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: "gold" | "default";
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
      {sub && (
        <div className="text-[10px] text-muted-foreground mt-1 truncate">{sub}</div>
      )}
    </div>
  );
}
