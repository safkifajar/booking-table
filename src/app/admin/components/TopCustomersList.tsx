import Link from "next/link";
import { cn, initials } from "@/lib/utils";
import type { TopCustomer } from "@/lib/admin";

export function TopCustomersList({ customers }: { customers: TopCustomer[] }) {
  if (customers.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        No visits in this period.
      </div>
    );
  }

  const maxVisits = Math.max(...customers.map((c) => c.visit_count), 1);
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));

  return (
    <div className="space-y-2">
      {customers.map((c, idx) => {
        const barWidth = (c.visit_count / maxVisits) * 100;
        return (
          <Link
            key={c.profile_id}
            href={`/admin/users/${c.profile_id}`}
            className="relative flex items-center gap-3 rounded-md border border-border bg-muted/20 p-3 overflow-hidden transition hover:border-primary/40"
          >
            {/* Background bar (proporsional jumlah kunjungan) */}
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent pointer-events-none"
              style={{ width: `${barWidth}%` }}
            />
            {/* Content */}
            <span className="relative w-8 shrink-0 text-xs font-bold tabular-nums text-primary/70">
              #{idx + 1}
            </span>
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
              {c.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.avatar_url}
                  alt={c.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-medium text-muted-foreground">
                  {initials(c.name)}
                </span>
              )}
            </div>
            <div className="relative flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{c.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {c.username ? `@${c.username}` : "—"}
                {c.last_visit && <> · last {fmtDate(c.last_visit)}</>}
              </p>
            </div>
            <div className="relative shrink-0 text-right">
              <div className="text-sm font-semibold text-primary tabular-nums">
                {c.visit_count}×
              </div>
              <div className="text-[10px] text-muted-foreground">visits</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
