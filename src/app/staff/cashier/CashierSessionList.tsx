"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  CheckCircle2,
  Clock,
  ChevronRight,
  Crown,
  Wallet,
  Sparkles,
  Layers,
  CalendarClock,
  ArrowRightLeft,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { UserPlus } from "lucide-react";
import { formatIDR, initials, cn } from "@/lib/utils";
import { OpenTableModal } from "@/components/staff/OpenTableModal";
import type {
  CashierSessionItem,
  CashierBookingItem,
} from "@/lib/cashier-actions";
import type {
  AvailableTable,
  WaiterReservationData,
} from "@/lib/waiter-actions";
import {
  MoveRequestsPanel,
  countPending,
} from "@/components/staff/MoveRequestsPanel";
import { StaffTabs } from "@/components/staff/StaffTabs";
import {
  SessionListFilters,
  filterSessions,
  currentMonthRange,
  type SessionFilterState,
} from "@/components/staff/SessionListFilters";
import type { MoveRequestRow } from "@/lib/move-approval-actions";

interface Props {
  sessions: CashierSessionItem[];
  bookings: CashierBookingItem[];
  availableTables: AvailableTable[];
  reservationData: WaiterReservationData;
  moveRequests: MoveRequestRow[];
  closedSessions: CashierSessionItem[];
  barId: string;
}

type Tab = "active" | "bookings" | "moves" | "done";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}
/**
 * Label waktu pemakaian meja: tanggal + jam (bukan "x jam lalu"). Pakai rentang
 * reservasi kalau ada (booking → "28 Jun 2026 · 21:00–23:00"), selain itu jam
 * mulai pakai (walk-in → "28 Jun 2026 · 20:36").
 */
function usageLabel(s: {
  reservation_at: string | null;
  reservation_end_at: string | null;
  started_at: string;
}): string {
  const start = s.reservation_at ?? s.started_at;
  const tgl = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(start));
  const waktu = s.reservation_end_at
    ? `${fmtTime(start)}–${fmtTime(s.reservation_end_at)}`
    : fmtTime(start);
  return `${tgl} · ${waktu}`;
}

/**
 * Cashier session list — card layout (mobile-friendly).
 *
 * Kalau nanti butuh dense view di desktop, bisa di-extend pakai
 * `hidden md:block` pattern dengan table sebagai variant. Untuk MVP,
 * card layout cocok di semua screen size karena mobile-first.
 */
export function CashierSessionList({
  sessions,
  bookings,
  availableTables,
  reservationData,
  moveRequests,
  closedSessions,
  barId,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("active");
  const [openTableModal, setOpenTableModal] = React.useState(false);

  // Filter tab "Meja Aktif" (default rentang bulan berjalan)
  const [filter, setFilter] = React.useState<SessionFilterState>(() => ({
    ...currentMonthRange(),
    pay: "all",
  }));
  const [query, setQuery] = React.useState("");

  // Filter tab "Selesai"
  const [doneFilter, setDoneFilter] = React.useState<SessionFilterState>(() => ({
    ...currentMonthRange(),
    pay: "all",
  }));
  const [doneQuery, setDoneQuery] = React.useState("");

  // Realtime: subscribe SSE staff channel
  React.useEffect(() => {
    if (!barId) return;
    const es = new EventSource(`/api/realtime/staff/${barId}`);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => router.refresh(), 400);
    };
    es.onerror = () => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] staff:${barId} disconnected`);
      }
    };
    return () => {
      es.close();
      if (debounce) clearTimeout(debounce);
    };
  }, [barId, router]);

  const filtered = React.useMemo(
    () => filterSessions(sessions, { ...filter, query }),
    [sessions, filter, query]
  );

  const filteredClosed = React.useMemo(
    () => filterSessions(closedSessions, { ...doneFilter, query: doneQuery }),
    [closedSessions, doneFilter, doneQuery]
  );

  // Quick stats. "Meja aktif" = jumlah sesi aktif. "Outstanding" & "Sudah bayar"
  // mencakup sesi aktif DAN sesi closed yg masih punya sisa tagihan (closed
  // belum lunas) — supaya tagihan yg masih perlu ditagih tetap terhitung, tidak
  // hilang begitu sesi ditutup.
  const totalOpen = sessions.length;
  const closedUnpaid = closedSessions.filter((x) => x.outstanding > 0);
  const totalUnpaid =
    sessions.reduce((s, x) => s + x.outstanding, 0) +
    closedUnpaid.reduce((s, x) => s + x.outstanding, 0);
  const totalPaidPartial =
    sessions.reduce((s, x) => s + x.paid_total, 0) +
    closedUnpaid.reduce((s, x) => s + x.paid_total, 0);

  return (
    <div className="space-y-4 pb-24">
      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Active tables"
          value={totalOpen.toString()}
        />
        <StatCard
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Paid"
          value={formatIDR(totalPaidPartial)}
          tone="success"
        />
        <StatCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Outstanding"
          value={formatIDR(totalUnpaid)}
          tone={totalUnpaid > 0 ? "warning" : "muted"}
        />
      </div>

      {/* Tab strip (komponen bersama dgn waiter) */}
      <StaffTabs
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          {
            key: "active",
            label: "Active Tables",
            icon: <Layers className="h-3.5 w-3.5" />,
            badge: sessions.length,
          },
          {
            key: "bookings",
            label: "Bookings",
            icon: <CalendarClock className="h-3.5 w-3.5" />,
            badge: bookings.length,
          },
          {
            key: "moves",
            label: "Move Table",
            icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
            badge: countPending(moveRequests),
            alert: countPending(moveRequests) > 0,
          },
          {
            key: "done",
            label: "Done",
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {tab === "active" && (
        <>
          <SessionListFilters
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
          />

          {/* Session list */}
          {filtered.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <Wallet className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              {sessions.length === 0 ? (
                <>
                  <p className="text-sm font-medium mb-1">No active tables yet</p>
                  <p className="text-xs text-muted-foreground">
                    Tables will appear here after a customer opens a session.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium mb-1">No results</p>
                  <p className="text-xs text-muted-foreground">
                    Try changing the filter or search term.
                  </p>
                </>
              )}
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {filtered.map((s) => (
                <SessionCard key={s.session_id} session={s} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "bookings" && <BookingsList bookings={bookings} />}

      {tab === "moves" && <MoveRequestsPanel requests={moveRequests} />}

      {tab === "done" && (
        <div className="space-y-3">
          {closedSessions.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <CheckCircle2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium mb-1">No completed sessions yet</p>
              <p className="text-xs text-muted-foreground">
                Closed tables will appear here.
              </p>
            </Card>
          ) : (
            <>
              <SessionListFilters
                filter={doneFilter}
                onFilter={setDoneFilter}
                query={doneQuery}
                onQuery={setDoneQuery}
              />
              {filteredClosed.length === 0 ? (
                <Card className="p-8 text-center border-dashed">
                  <p className="text-sm text-muted-foreground">
                    No sessions in this filter.
                  </p>
                </Card>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {filteredClosed.map((s) => (
                    <SessionCard key={s.session_id} session={s} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tombol "Buka Meja Baru" — sticky di bawah */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3">
          <Button
            type="button"
            variant="gold"
            size="lg"
            className="w-full"
            onClick={() => setOpenTableModal(true)}
            disabled={availableTables.length === 0}
          >
            <UserPlus className="h-4 w-4" />
            Open Table
            {availableTables.length > 0 && (
              <span className="ml-1 text-xs opacity-70">
                ({availableTables.length} tables free)
              </span>
            )}
          </Button>
        </div>
      </div>

      {openTableModal && (
        <OpenTableModal
          tables={availableTables}
          reservationData={reservationData}
          onClose={() => setOpenTableModal(false)}
        />
      )}
    </div>
  );
}

// Daftar reservasi terjadwal (status reserved) + filter tanggal.
function BookingsList({ bookings }: { bookings: CashierBookingItem[] }) {
  const [dateFilter, setDateFilter] = React.useState<string>("all");

  const dateKey = (b: CashierBookingItem) => {
    const d = new Date(b.reservation_at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };
  const dates = React.useMemo(() => {
    const set = new Set(bookings.map(dateKey));
    return Array.from(set).sort();
  }, [bookings]);
  const filtered =
    dateFilter === "all"
      ? bookings
      : bookings.filter((b) => dateKey(b) === dateFilter);

  if (bookings.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium mb-1">No scheduled bookings yet</p>
        <p className="text-xs text-muted-foreground">
          Reservations that haven&apos;t started yet will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {dates.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {["all", ...dates].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDateFilter(d)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition whitespace-nowrap",
                dateFilter === d
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {d === "all" ? "All" : fmtDate(d)}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground">
            No bookings on this date.
          </p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map((b) => (
            <Link
              key={b.session_id}
              href={`/session/${b.session_id}?from=/staff/cashier`}
            >
              <Card className="p-4 hover:border-primary/40 transition">
                <div className="flex items-start gap-2 mb-2">
                  <Avatar className="h-9 w-9 shrink-0">
                    {b.host_avatar && (
                      <AvatarImage src={b.host_avatar} alt={b.host_name} />
                    )}
                    <AvatarFallback className="text-[10px]">
                      {initials(b.host_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Badge variant="default" className="text-[10px] px-1.5">
                        {b.table_label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {b.area_name}
                      </span>
                    </div>
                    <div className="text-sm font-medium truncate">
                      {b.title ?? b.host_name}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span className="inline-flex items-center gap-0.5">
                        <Crown className="h-2.5 w-2.5" />
                        {b.host_name}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5">
                        <Users className="h-2.5 w-2.5" />
                        {b.member_count}/{b.table_capacity}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-xs text-primary">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium">
                    {fmtDate(b.reservation_at)} · {fmtTime(b.reservation_at)}
                    {b.reservation_end_at && `–${fmtTime(b.reservation_end_at)}`}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "muted",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "success" | "warning" | "muted";
}) {
  const toneColor =
    tone === "success"
      ? "text-emerald-400"
      : tone === "warning"
        ? "text-amber-400"
        : "text-foreground";
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn("text-lg font-bold tabular-nums truncate", toneColor)}>
        {value}
      </div>
    </Card>
  );
}

function SessionCard({ session }: { session: CashierSessionItem }) {
  const paidPercentage =
    session.subtotal > 0
      ? Math.min(100, Math.round((session.paid_total / session.subtotal) * 100))
      : 0;

  return (
    <Link
      href={`/session/${session.session_id}?from=/staff/cashier`}
      className="block group"
    >
      <Card
        className={cn(
          "p-4 hover:border-primary/40 transition cursor-pointer",
          session.is_paid && "border-emerald-500/30 bg-emerald-500/[0.02]"
        )}
      >
        {/* Header row */}
        <div className="flex items-start gap-2 mb-3">
          <Avatar className="h-9 w-9 shrink-0">
            {session.host_avatar && (
              <AvatarImage src={session.host_avatar} alt={session.host_name} />
            )}
            <AvatarFallback className="text-[10px]">
              {initials(session.host_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <Badge variant="default" className="text-[10px] px-1.5">
                {session.table_label}
              </Badge>
              <span className="text-[10px] text-muted-foreground truncate">
                {session.area_name}
              </span>
              {session.is_walk_in && (
                <Badge
                  variant="default"
                  className="bg-primary/15 text-primary border-primary/30 text-[10px] px-1.5 gap-1"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  Walk-in
                </Badge>
              )}
            </div>
            <div className="text-sm font-medium truncate group-hover:text-primary transition">
              {session.title ?? "Open Table"}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
              <span className="inline-flex items-center gap-0.5">
                <Crown className="h-2.5 w-2.5" />
                {session.host_name}
              </span>
              <span>·</span>
              <span className="whitespace-nowrap tabular-nums">
                {usageLabel(session)}
              </span>
            </div>
            {session.is_walk_in && session.opened_by_staff_name && (
              <div className="text-[10px] text-primary/70 mt-0.5 truncate">
                Opened by {session.opened_by_staff_name}
                {session.guest_names.length > 1 && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {session.guest_names.length} guests
                  </span>
                )}
              </div>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0 mt-2" />
        </div>

        {/* Bill summary */}
        <div className="space-y-2 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total bill</span>
            <span className="font-semibold tabular-nums">
              {formatIDR(session.subtotal)}
            </span>
          </div>

          {session.subtotal > 0 && (
            <>
              {/* Progress bar */}
              <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    session.is_paid ? "bg-emerald-500" : "bg-primary"
                  )}
                  style={{ width: `${paidPercentage}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                {session.is_paid ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Paid
                  </span>
                ) : session.paid_total > 0 ? (
                  <>
                    <span className="text-emerald-400 tabular-nums">
                      {formatIDR(session.paid_total)} paid
                    </span>
                    <span className="text-amber-400 tabular-nums font-medium">
                      {formatIDR(session.outstanding)} remaining
                    </span>
                  </>
                ) : (
                  <span className="text-amber-400 font-medium tabular-nums">
                    Unpaid
                  </span>
                )}
              </div>
            </>
          )}

          {session.subtotal === 0 && (
            <div className="text-xs text-muted-foreground italic">
              No orders yet
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
