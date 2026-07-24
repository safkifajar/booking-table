"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { formatIDR, cn } from "@/lib/utils";
import {
  Crown,
  Users,
  Lock,
  ChevronRight,
  History,
  Clock,
} from "lucide-react";

/** Baris sesi (Date → ISO string untuk client). */
export interface SessionHistoryRow {
  id: string;
  title: string | null;
  status: "reserved" | "open" | "locked" | "closed" | "cancelled" | "overdue";
  started_at: string;
  reservation_at: string | null;
  reservation_end_at: string | null;
  table_label: string;
  area_name: string;
  bar_name: string;
  is_host: boolean;
  member_status: "pending" | "joined" | "left" | "kicked" | null;
  outstanding: number;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Patokan tanggal sesi = reservation_at kalau ada, else started_at. */
function sessionDate(s: SessionHistoryRow): Date {
  return new Date(s.reservation_at ?? s.started_at);
}

/**
 * Daftar Session History + filter BULAN/TAHUN (pola sama dgn dashboard staff).
 * Default: bulan & tahun sekarang. Strip pil bulan (auto-scroll ke aktif) +
 * dropdown tahun + counter + reset.
 */
export function SessionsHistoryView({ rows }: { rows: SessionHistoryRow[] }) {
  const now = React.useMemo(() => new Date(), []);
  const [month, setMonth] = React.useState<number>(now.getMonth());
  const [year, setYear] = React.useState<number | "all">(now.getFullYear());

  // Auto-scroll strip bulan ke chip aktif saat mount (default bulan sekarang
  // sering di luar layar).
  const stripRef = React.useRef<HTMLDivElement>(null);
  const activeChipRef = React.useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => {
    const strip = stripRef.current;
    const chip = activeChipRef.current;
    if (!strip || !chip) return;
    strip.scrollLeft =
      chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
  }, []);

  /** Opsi tahun: SELALU tahun sekarang + 2 tahun sebelumnya (mis. 2026/2025/
   *  2024), plus tahun apa pun yang ada di data (jaga-jaga data lebih lama).
   *  Otomatis bergeser tiap tahun berganti. */
  const years = React.useMemo(() => {
    const cur = now.getFullYear();
    const set = new Set<number>([cur, cur - 1, cur - 2]);
    for (const r of rows) {
      const d = sessionDate(r);
      if (!Number.isNaN(d.getTime())) set.add(d.getFullYear());
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [rows, now]);

  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      const d = sessionDate(r);
      if (Number.isNaN(d.getTime())) return false;
      if (year !== "all" && d.getFullYear() !== year) return false;
      if (d.getMonth() !== month) return false;
      return true;
    });
  }, [rows, month, year]);

  if (rows.length === 0) return <EmptyState />;

  return (
    <div className="space-y-3">
      {/* Filter bulan/tahun — sticky di atas list saat scroll. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-2 bg-background border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <div
            ref={stripRef}
            className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar"
          >
            {MONTH_LABELS.map((m, i) => (
              <button
                key={m}
                ref={month === i ? activeChipRef : undefined}
                type="button"
                onClick={() => setMonth(i)}
                className={cn(
                  "shrink-0 rounded-md border px-3 h-9 text-xs font-medium transition",
                  month === i
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/60"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="shrink-0">
            <Select
              value={String(year)}
              onChange={(v) => setYear(v === "all" ? "all" : Number(v))}
              options={[
                { value: "all", label: "All" },
                ...years.map((y) => ({ value: String(y), label: String(y) })),
              ]}
              ariaLabel="Filter year"
              className="w-[86px]"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No sessions in {MONTH_LABELS[month]} {year === "all" ? "" : year}.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {filtered.map((s) => (
            <SessionListItem key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Label waktu pemakaian meja: tanggal + jam (rentang reservasi kalau ada). */
function usageLabel(session: SessionHistoryRow): string {
  const start = new Date(session.reservation_at ?? session.started_at);
  const end = session.reservation_end_at
    ? new Date(session.reservation_end_at)
    : null;
  const tgl = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  const jam = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  if (!end) return `${tgl(start)} · ${jam(start)}`;
  if (start.toDateString() !== end.toDateString()) {
    return `${tgl(start)} ${jam(start)} – ${tgl(end)} ${jam(end)}`;
  }
  return `${tgl(start)} · ${jam(start)}–${jam(end)}`;
}

function SessionListItem({ session }: { session: SessionHistoryRow }) {
  const href = `/session/${session.id}?from=${encodeURIComponent(
    "/profile/sessions"
  )}`;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="default" className="text-[10px] px-1.5">
            {session.table_label}
          </Badge>
          <span className="text-[10px] text-muted-foreground truncate">
            {session.area_name} · {session.bar_name}
          </span>
          {session.is_host && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-primary"
              aria-label="You are the host"
            >
              <Crown className="h-3 w-3" />
              Host
            </span>
          )}
        </div>
        <div className="text-sm font-medium truncate">
          {session.title ?? "Table Details"}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{usageLabel(session)}</span>
          <span>·</span>
          <StatusBadge
            status={session.status}
            memberStatus={session.member_status}
            isHost={session.is_host}
          />
          {session.outstanding > 0 &&
            session.status !== "reserved" &&
            session.status !== "cancelled" && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-orange-400 font-medium">
                  Unpaid {formatIDR(session.outstanding)}
                </span>
              </>
            )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0" />
    </Link>
  );
}

function StatusBadge({
  status,
  memberStatus,
  isHost,
}: {
  status: SessionHistoryRow["status"];
  memberStatus: SessionHistoryRow["member_status"];
  isHost: boolean;
}) {
  if (!isHost && memberStatus === "kicked") {
    return <span className="text-red-400/80">Removed</span>;
  }
  if (!isHost && memberStatus === "left") {
    return <span className="text-muted-foreground">Left</span>;
  }
  if (status === "reserved") {
    return (
      <span className="inline-flex items-center gap-1 text-sky-400">
        <Clock className="h-3 w-3" /> Booking
      </span>
    );
  }
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <Users className="h-3 w-3" /> In progress
      </span>
    );
  }
  if (status === "locked") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-400">
        <Lock className="h-3 w-3" /> Locked
      </span>
    );
  }
  if (status === "overdue") {
    return (
      <span className="inline-flex items-center gap-1 text-orange-400">
        <Users className="h-3 w-3" /> Overdue
      </span>
    );
  }
  if (status === "cancelled") {
    return <span className="text-muted-foreground">Cancelled</span>;
  }
  return <span className="text-muted-foreground">Done</span>;
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <History className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
      <h2 className="text-sm font-medium mb-1">No history yet</h2>
      <p className="text-xs text-muted-foreground">
        Once you open or join a table, your session history will appear here.
      </p>
    </div>
  );
}
