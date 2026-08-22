"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getEmailLogBody,
  type EmailLogRow,
} from "@/lib/email-log-actions";
import { cn, getActionErrorMessage } from "@/lib/utils";

/** Sama dengan Staff Activity: 24 jam, waktu Jakarta. */
function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(new Date(d));
}

const STATUS_STYLE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  dry_run: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  dry_run: "Dry run",
};

const KIND_LABEL: Record<string, string> = {
  password_reset: "Password reset",
  magic_link: "Magic link",
  staff_invite: "Staff invite",
  table_invite: "Table invite",
  other: "Other",
};

export function EmailLogList({
  rows,
  total,
  counts,
  page,
  pageSize,
  search: initialSearch,
  status,
}: {
  rows: EmailLogRow[];
  total: number;
  counts: { success: number; failed: number; dryRun: number };
  page: number;
  pageSize: number;
  search: string;
  status: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [search, setSearch] = React.useState(initialSearch);
  const [viewing, setViewing] = React.useState<EmailLogRow | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || v === "all") params.delete(k);
      else params.set(k, String(v));
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="space-y-3">
      {/* Ringkasan — angkanya TIDAK ikut tersaring, supaya bisa dipakai
          berpindah antar-status. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:max-w-lg">
        {(
          [
            ["all", "All", total],
            ["success", "Success", counts.success],
            ["failed", "Failed", counts.failed],
            ["dry_run", "Dry run", counts.dryRun],
          ] as const
        ).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => pushParams({ status: key, page: 1 })}
            className={cn(
              "rounded-lg border px-3 py-2 text-center transition",
              status === key
                ? "border-primary/60 bg-primary/10"
                : "border-border bg-background/40 hover:bg-muted/40"
            )}
          >
            <span className="block text-lg font-semibold leading-none">{n}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {label}
            </span>
          </button>
        ))}
      </div>

      <Card className="p-4 space-y-3">
        {/* Pencarian */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pushParams({ q: search, page: 1 });
          }}
          className="relative max-w-sm"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipient or subject…"
            className="h-9 w-full rounded-md border border-border bg-input pl-9 pr-8 text-sm focus:border-primary/60 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                pushParams({ q: undefined, page: 1 });
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium">No emails logged yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Entries appear here as soon as the app sends an email.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Recipient</th>
                  <th className="pb-2 pr-3 font-medium">Subject</th>
                  <th className="pb-2 pr-3 font-medium">Type</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Sent at</th>
                  <th className="pb-2 font-medium text-right">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-2.5 pr-3 align-top">
                      <span className="block max-w-[220px] truncate font-medium">
                        {r.recipient}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        via {r.provider}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      <span className="block max-w-[260px] truncate">
                        {r.subject}
                      </span>
                      {/* Alasan gagal ditampilkan langsung di baris — itu
                          yang dicari admin, tak perlu membuka apa pun. */}
                      {r.error && (
                        <span className="mt-0.5 block max-w-[260px] truncate text-[11px] text-red-400">
                          {r.error}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 align-top text-xs text-muted-foreground">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          STATUS_STYLE[r.status] ?? "border-border"
                        )}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 align-top text-xs text-muted-foreground">
                      {fmtDateTime(r.createdAt)}
                    </td>
                    <td className="py-2.5 text-right align-top">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="View email source"
                        onClick={() => setViewing(r)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => pushParams({ size: e.target.value, page: 1 })}
              className="h-8 rounded-md border border-border bg-input px-2 text-xs focus:border-primary/60 focus:outline-none"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>per page</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                aria-label="First page"
                disabled={page <= 1}
                onClick={() => pushParams({ page: 1 })}
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => pushParams({ page: page - 1 })}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2 text-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label="Next page"
                disabled={page >= totalPages}
                onClick={() => pushParams({ page: page + 1 })}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Last page"
                disabled={page >= totalPages}
                onClick={() => pushParams({ page: totalPages })}
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {viewing && (
        <EmailBodyModal row={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/**
 * Isi email sebagai HTML MENTAH, bukan tampilan jadinya.
 *
 * Untuk menelusuri masalah, yang dibutuhkan justru sumbernya — tautan yang
 * benar-benar tertanam, gaya yang dipakai, karakter yang lolos. Tampilan
 * jadinya sudah bisa dilihat di kotak masuk penerima.
 */
function EmailBodyModal({
  row,
  onClose,
}: {
  row: EmailLogRow;
  onClose: () => void;
}) {
  const [html, setHtml] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getEmailLogBody(row.id);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error ?? "Couldn't load the email body");
          return;
        }
        setHtml(res.html ?? "");
      } catch (err) {
        if (!cancelled) {
          const msg = getActionErrorMessage(
            err,
            "Couldn't load the email body"
          );
          setError(msg);
          toast.error(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{row.subject}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              To {row.recipient} · {fmtDateTime(row.createdAt)}
              {row.providerMessageId && ` · ${row.providerMessageId}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-[200px] flex-1 overflow-auto p-4">
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : html === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : html === "" ? (
            <p className="text-sm text-muted-foreground">
              No body was stored for this email.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {html.length.toLocaleString("en-US")} characters
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(html);
                    toast.success("HTML copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-background/60 p-3 text-[11px] leading-relaxed">
                <code className="whitespace-pre-wrap break-all font-mono">
                  {html}
                </code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
