import { requireAdmin, resolveDateRange, type DateRangePreset } from "@/lib/admin";
import { listActivityLogs, listActivityActors } from "@/lib/activity-log";
import { DateRangeFilter } from "../DateRangeFilter";
import { ActivityList } from "./ActivityList";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    size?: string;
    category?: string;
    actor?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
}

/**
 * Riwayat aktivitas staff — "siapa melakukan apa, kapan".
 * Hanya admin & manager (requireAdmin sudah menolak kasir/waiter).
 */
export default async function AdminActivityPage({ searchParams }: PageProps) {
  const bar = await requireAdmin();
  const { q, page, size, category, actor, range, from, to } = await searchParams;

  const dateRange = resolveDateRange(
    (range as DateRangePreset) ?? "last30",
    from,
    to
  );
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = [20, 50, 100].includes(Number(size)) ? Number(size) : 20;

  const [{ rows, total }, actors] = await Promise.all([
    listActivityLogs({
      barId: bar.id,
      search: q,
      category,
      actorId: actor,
      from: dateRange.from,
      to: dateRange.to,
      page: pageNum,
      pageSize,
    }),
    listActivityActors(bar.id),
  ]);

  return (
    <>
      <DateRangeFilter currentLabel={dateRange.label} defaultPreset="last30" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-primary/70 font-semibold">
            Audit
          </p>
          <h1 className="text-2xl font-bold">Staff Activity</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            What each staff member did and when. Useful for checking payments,
            table handling, and data changes.
          </p>
        </div>

        <ActivityList
          rows={rows}
          total={total}
          page={pageNum}
          pageSize={pageSize}
          query={q ?? ""}
          category={category ?? "all"}
          actorId={actor ?? ""}
          actors={actors}
        />
      </div>
    </>
  );
}
