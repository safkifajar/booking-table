import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { listMembershipTransactions } from "@/lib/membership-actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatIDR } from "@/lib/utils";
import { ExportCsvButton } from "./ExportCsvButton";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

const STATUSES = ["pending", "paid", "failed", "refunded"] as const;
type TxStatus = (typeof STATUSES)[number];
const PAGE_SIZE = 25;

const KIND_LABEL: Record<string, string> = {
  purchase: "Purchase",
  renewal: "Renewal",
  admin_grant: "Admin grant",
};

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  refunded: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Daftar pembayaran membership (PRD Membership M9) — terpisah dari payments F&B. */
export default async function AdminMembershipTxPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as TxStatus)
    ? (params.status as TxStatus)
    : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const { rows, total } = await listMembershipTransactions({ status, page });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterHref = (s?: string) =>
    s ? `/admin/membership/transactions?status=${s}` : "/admin/membership/transactions";

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Membership Transactions
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              All membership purchases, renewals, and admin grants ({total}).
            </p>
          </div>
          <ExportCsvButton rows={rows} page={page} />
        </div>

        {/* Filter status */}
        <div className="flex flex-wrap gap-1.5">
          <FilterChip href={filterHref()} active={!status} label="All" />
          {STATUSES.map((s) => (
            <FilterChip
              key={s}
              href={filterHref(s)}
              active={status === s}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
            />
          ))}
        </div>

        {rows.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">
            No membership transactions{status ? ` with status "${status}"` : ""} yet.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium w-24">Level</th>
                    <th className="px-4 py-3 font-medium w-28">Type</th>
                    <th className="px-4 py-3 font-medium w-24">Status</th>
                    <th className="px-4 py-3 font-medium w-40">Date</th>
                    <th className="px-4 py-3 font-medium w-32">Until</th>
                    <th className="px-4 py-3 font-medium w-36 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/users/${r.customer_id}`}
                          className="font-medium hover:text-primary transition block truncate max-w-[220px]"
                        >
                          {r.customer_name}
                        </Link>
                        <span className="text-xs text-muted-foreground block truncate max-w-[220px]">
                          {r.customer_email}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="text-[10px]">
                          {r.level_name}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className="text-[10px]">
                          {KIND_LABEL[r.kind] ?? r.kind}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="secondary"
                          className={cn("text-[10px]", STATUS_STYLE[r.status])}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmt(r.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {r.period_end
                          ? new Date(r.period_end).toLocaleDateString("en-US", {
                              dateStyle: "medium",
                            })
                          : "Lifetime"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="font-semibold tabular-nums">
                          {formatIDR(r.amount)}
                        </div>
                        {r.tax_amount + r.service_amount > 0 && (
                          <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                            incl.{" "}
                            {r.tax_amount > 0 && r.service_amount > 0
                              ? "tax & service"
                              : r.tax_amount > 0
                                ? "tax"
                                : "service charge"}{" "}
                            {formatIDR(r.tax_amount + r.service_amount)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Pagination sederhana via link */}
        {totalPages > 1 && (
          <div className="flex justify-end gap-1.5 text-sm">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={`/admin/membership/transactions?${new URLSearchParams({
                  ...(status ? { status } : {}),
                  page: String(p),
                }).toString()}`}
                className={cn(
                  "h-8 min-w-8 px-2 rounded-md border flex items-center justify-center",
                  p === page
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border hover:border-foreground/30"
                )}
              >
                {p}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:border-foreground/30"
      )}
    >
      {label}
    </Link>
  );
}
