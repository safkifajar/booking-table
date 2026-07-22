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
  Banknote,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { UserPlus } from "lucide-react";
import { formatIDR, initials, cn } from "@/lib/utils";
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
import { StaffBottomNav } from "@/components/staff/StaffBottomNav";
import { PayAtCashierCountdown } from "@/components/session/PayAtCashierCountdown";
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

  // Quick stats — HANYA DATA HARI INI (arahan user). "Meja aktif" = sesi aktif
  // hari ini; "Paid"/"Outstanding" dari sesi hari ini (aktif + closed yg masih
  // punya sisa tagihan). Patokan tanggal: closed_at (kalau sudah tutup) →
  // reservation_at → started_at, dibandingkan di zona WIB.
  const isToday = React.useCallback((s: CashierSessionItem) => {
    const iso = s.closed_at ?? s.reservation_at ?? s.started_at;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    const TZ = 7 * 3600 * 1000;
    const dayOf = (ms: number) =>
      Math.floor((ms + TZ) / (24 * 3600 * 1000)); // indeks hari di WIB
    return dayOf(t) === dayOf(Date.now());
  }, []);

  const todaySessions = React.useMemo(
    () => sessions.filter(isToday),
    [sessions, isToday]
  );
  const todayClosedUnpaid = React.useMemo(
    () => closedSessions.filter((x) => x.outstanding > 0 && isToday(x)),
    [closedSessions, isToday]
  );

  const totalOpen = todaySessions.length;
  const totalUnpaid =
    todaySessions.reduce((s, x) => s + x.outstanding, 0) +
    todayClosedUnpaid.reduce((s, x) => s + x.outstanding, 0);
  const totalPaidPartial =
    todaySessions.reduce((s, x) => s + x.paid_total, 0) +
    todayClosedUnpaid.reduce((s, x) => s + x.paid_total, 0);

  return (
    // Flex column setinggi sisa layar (di bawah header ~64px, minus py-6
    // wrapper = ~112px). Stats+filter shrink-0 (DIAM), list flex-1 scroll
    // sendiri → stats tak ikut scroll sama sekali (pola tab Floor/Menu/Network,
    // bukan sticky yg sempat travel).
    <div className="flex flex-col h-[calc(100dvh-5.5rem)] -mb-6">
      {/* Quick stats + filter — DIAM (di luar area scroll). */}
      <div className="shrink-0 pb-3 border-b border-border space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            icon={<Users className="h-3.5 w-3.5" />}
            label="Active today"
            value={totalOpen.toString()}
          />
          <StatCard
            icon={<Wallet className="h-3.5 w-3.5" />}
            label="Paid today"
            value={formatIDR(totalPaidPartial)}
            tone="success"
          />
          <StatCard
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Outstanding today"
            value={formatIDR(totalUnpaid)}
            tone={totalUnpaid > 0 ? "warning" : "muted"}
          />
        </div>
        {tab === "active" && (
          <SessionListFilters
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
          />
        )}
        {tab === "done" && (
          <SessionListFilters
            filter={doneFilter}
            onFilter={setDoneFilter}
            query={doneQuery}
            onQuery={setDoneQuery}
          />
        )}
      </div>

      {/* Navigasi tab → bottom nav (fixed). Tombol Open Table di topSlot supaya
          nempel di atas nav tanpa celah. */}
      <StaffBottomNav
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        topSlot={
          <Button asChild variant="gold" size="lg" className="w-full">
            <Link href="/staff/open-table?from=cashier">
              <UserPlus className="h-4 w-4" />
              Open Table
              {availableTables.length > 0 && (
                <span className="ml-1 text-xs opacity-70">
                  ({availableTables.length} tables free)
                </span>
              )}
            </Link>
          </Button>
        }
        tabs={[
          {
            key: "active",
            label: "Active",
            icon: <Layers className="h-5 w-5" />,
            badge: sessions.length,
          },
          {
            key: "bookings",
            label: "Bookings",
            icon: <CalendarClock className="h-5 w-5" />,
            badge: bookings.length,
          },
          {
            key: "moves",
            label: "Move",
            icon: <ArrowRightLeft className="h-5 w-5" />,
            badge: countPending(moveRequests),
            alert: countPending(moveRequests) > 0,
          },
          {
            key: "done",
            label: "Done",
            icon: <CheckCircle2 className="h-5 w-5" />,
          },
        ]}
      />

      {/* List: SATU area scroll internal (flex-1). Hanya ini yg bergulir →
          stats+filter di atas benar2 diam. pb utk ruang footer Open Table+nav.
          -mx utk full-bleed scrollbar. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4 pb-[calc(13rem+env(safe-area-inset-bottom))] [&>*:not(:first-child)]:mt-4">

      {tab === "active" && (
        <>
          {/* Session list (filter sudah pindah ke area sticky di atas) */}
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
              {/* filter pindah ke area sticky di atas */}
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
      </div>{/* /scroll container */}

    </div>
  );
}

// Daftar reservasi terjadwal (status reserved) + filter tanggal.
function BookingsList({ bookings }: { bookings: CashierBookingItem[] }) {
  const router = useRouter();
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
              // DP menunggu konfirmasi kasir → langsung ke ORDER DETAIL (tempat
              // CashierConfirmBox berada) supaya kasir cepat konfirmasi. Selain
              // itu ke halaman sesi biasa (tab Table/Menu/Bill/Pay).
              href={
                b.dp_pending_cashier
                  ? `/session/${b.session_id}/order/${b.dp_pending_cashier.order_id}?from=/staff/cashier`
                  : `/session/${b.session_id}?from=/staff/cashier`
              }
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
                {b.dp_pending_cashier && (
                  <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 text-xs text-amber-400">
                    <Banknote className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium truncate flex-1">
                      DP {formatIDR(b.dp_pending_cashier.amount)} — waiting
                      payment
                    </span>
                    {/* Sisa waktu konfirmasi. Habis → refresh (server sudah
                        membatalkan booking via sweep → kartu hilang). */}
                    <PayAtCashierCountdown
                      expiresAt={b.dp_pending_cashier.expires_at}
                      onExpire={() => router.refresh()}
                    >
                      {(mmss) => (
                        <span className="shrink-0 tabular-nums font-semibold rounded bg-amber-500/20 px-1.5 py-0.5">
                          {mmss}
                        </span>
                      )}
                    </PayAtCashierCountdown>
                  </div>
                )}
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
    <Card className="p-3 min-w-0">
      <div className="flex items-center gap-1 text-[9px] sm:text-[10px] uppercase tracking-wide text-muted-foreground mb-1 min-w-0">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      {/* Nominal: font mengecil di mobile supaya angka penuh tak terpotong. */}
      <div
        className={cn(
          "font-bold tabular-nums leading-tight text-sm sm:text-lg",
          toneColor
        )}
      >
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
      // Ada order menunggu konfirmasi pay-at-cashier → langsung ke ORDER DETAIL
      // (tempat CashierConfirmBox) supaya kasir cepat konfirmasi; selain itu ke
      // halaman sesi biasa.
      href={
        session.cash_pending_order_id
          ? `/session/${session.session_id}/order/${session.cash_pending_order_id}?from=/staff/cashier`
          : `/session/${session.session_id}?from=/staff/cashier`
      }
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
              {session.cash_pending_count > 0 && (
                <Badge
                  variant="secondary"
                  className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px] px-1.5 gap-1"
                >
                  <Banknote className="h-2.5 w-2.5" />
                  Pay at cashier
                  {session.cash_pending_count > 1
                    ? ` ×${session.cash_pending_count}`
                    : ""}
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
