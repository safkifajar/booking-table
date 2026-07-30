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
  Utensils,
  Loader2,
  ChefHat,
  ShoppingBag,
  Calendar,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { UserPlus } from "lucide-react";
import { formatIDR, initials, cn, getActionErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { X } from "lucide-react";
import type {
  CashierSessionItem,
  CashierBookingItem,
  CashierOrderQueue,
  CashierOrderItem,
} from "@/lib/cashier-actions";
import { cashierMarkPreparing } from "@/lib/cashier-actions";
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
  orderQueue: CashierOrderQueue;
  barId: string;
}

type Tab = "orders" | "active" | "bookings" | "moves" | "done";

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
  orderQueue,
  barId,
}: Props) {
  const router = useRouter();
  // Default tab = Orders (kasir langsung lihat pesanan yang perlu diteruskan
  // ke dapur saat buka dashboard).
  const [tab, setTab] = React.useState<Tab>("orders");

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
            icon={<Users className="h-4 w-4" />}
            label="Active today"
            value={totalOpen.toString()}
            tone="primary"
          />
          <StatCard
            icon={<Wallet className="h-4 w-4" />}
            label="Paid today"
            value={formatIDR(totalPaidPartial)}
            tone="success"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Outstanding today"
            value={formatIDR(totalUnpaid)}
            tone="warning"
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
            key: "orders",
            label: "Orders",
            // Badge = item aktif yg masih 'sent' (perlu diteruskan ke dapur).
            icon: <Utensils className="h-5 w-5" />,
            badge: orderQueue.active.filter((i) => i.status === "sent").length,
            alert:
              orderQueue.active.some((i) => i.status === "sent"),
          },
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

      {tab === "orders" && (
        <CashierOrdersTab queue={orderQueue} />
      )}

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
                      DP {formatIDR(b.dp_pending_cashier.amount)} · waiting
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
  tone?: "primary" | "success" | "warning" | "muted";
}) {
  // Per-tone: warna ikon+kotak+gradasi kartu. Ikon dalam kotak berwarna di atas,
  // label kecil, angka besar (gaya kartu stat menonjol).
  const t = {
    primary: {
      icon: "text-primary",
      box: "bg-primary/15 border-primary/25",
      bg: "from-primary/[0.08]",
      value: "text-foreground",
    },
    success: {
      icon: "text-emerald-400",
      box: "bg-emerald-500/15 border-emerald-500/25",
      bg: "from-emerald-500/[0.08]",
      value: "text-emerald-400",
    },
    warning: {
      icon: "text-amber-400",
      box: "bg-amber-500/15 border-amber-500/25",
      bg: "from-amber-500/[0.08]",
      value: "text-amber-400",
    },
    muted: {
      icon: "text-muted-foreground",
      box: "bg-muted/40 border-border",
      bg: "from-transparent",
      value: "text-foreground",
    },
  }[tone];

  return (
    <Card
      className={cn(
        "p-3 min-w-0 bg-gradient-to-br to-transparent",
        t.bg
      )}
    >
      <span
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-lg border mb-2",
          t.box,
          t.icon
        )}
      >
        {icon}
      </span>
      <div className="text-[9px] sm:text-[10px] uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </div>
      <div
        className={cn(
          "font-bold tabular-nums leading-tight text-base sm:text-lg mt-0.5",
          t.value
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

/** Grup item order per meja (session_id). Urutan meja mengikuti item pertama. */
function groupByTable(items: CashierOrderItem[]) {
  const map = new Map<string, { label: string; area: string; reservation_at: string | null; items: CashierOrderItem[] }>();
  for (const it of items) {
    let g = map.get(it.session_id);
    if (!g) {
      g = {
        label: it.table_label,
        area: it.area_name,
        reservation_at: it.reservation_at,
        items: [],
      };
      map.set(it.session_id, g);
    }
    g.items.push(it);
  }
  return Array.from(map.entries()).map(([session_id, g]) => ({ session_id, ...g }));
}

/** Jumlah ORDER unik (bukan item) dari daftar item — 1 order bisa punya banyak item. */
function orderCount(items: CashierOrderItem[]): number {
  return new Set(items.map((i) => i.order_id)).size;
}

/**
 * Tab Orders kasir — dua section:
 *  - Active now: order di meja aktif → tombol "Mark as being prepared"
 *    (kasir teruskan ke dapur; sent → preparing).
 *  - Scheduled: order booking (jam belum tiba) → read-only, dapur belum buat.
 * Per meja. Kasir TIDAK menandai served (itu tugas waiter).
 */
function CashierOrdersTab({ queue }: { queue: CashierOrderQueue }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [sub, setSub] = React.useState<"active" | "scheduled">("active");

  async function markPreparing(itemId: string) {
    setBusy(itemId);
    try {
      await cashierMarkPreparing(itemId);
      toast.success("Order is being processed");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to update order"));
    } finally {
      setBusy(null);
    }
  }

  /** Proses SEMUA item satu order sekaligus — satu toast & satu refresh. */
  async function markPreparingMany(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setBusy(itemIds[0]); // tandai sibuk (tombol per-item ikut disabled)
    try {
      const results = await Promise.allSettled(
        itemIds.map((id) => cashierMarkPreparing(id))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === 0) {
        toast.success(
          `${itemIds.length} item${itemIds.length === 1 ? "" : "s"} are being processed`
        );
      } else if (failed < itemIds.length) {
        toast.error(`${itemIds.length - failed} processed, ${failed} failed`);
      } else {
        toast.error("Failed to update order");
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const activeTables = groupByTable(queue.active);
  const scheduledTables = groupByTable(queue.scheduled);
  const groups = sub === "active" ? activeTables : scheduledTables;

  // Meja yang dibuka (bottom-sheet daftar item). Dicari ulang dari queue tiap
  // render supaya isinya ikut ter-update setelah router.refresh().
  const [openId, setOpenId] = React.useState<string | null>(null);
  const openGroup = openId
    ? groups.find((g) => g.session_id === openId) ?? null
    : null;

  return (
    <div className="space-y-3">
      {/* Sub-tab segmented (pola waiter To Serve / Served Today). */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border w-full">
        <SubTabButton
          icon={<ChefHat className="h-3.5 w-3.5" />}
          label={`Active (${activeTables.length})`}
          active={sub === "active"}
          onClick={() => {
            setSub("active");
            setOpenId(null);
          }}
        />
        <SubTabButton
          icon={<Clock className="h-3.5 w-3.5" />}
          label={`Scheduled (${scheduledTables.length})`}
          active={sub === "scheduled"}
          onClick={() => {
            setSub("scheduled");
            setOpenId(null);
          }}
        />
      </div>

      {groups.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          {sub === "active" ? (
            <>
              <Utensils className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium mb-1">No active orders</p>
              <p className="text-xs text-muted-foreground">
                Paid orders show up here so you can forward them to the kitchen.
              </p>
            </>
          ) : (
            <>
              <Clock className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium mb-1">No scheduled orders</p>
              <p className="text-xs text-muted-foreground">
                Booking orders (time not reached yet) show up here. Don&apos;t
                make them yet.
              </p>
            </>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((t) => (
            <OrderTableCard
              key={t.session_id}
              group={t}
              scheduled={sub === "scheduled"}
              onOpen={() => setOpenId(t.session_id)}
            />
          ))}
        </div>
      )}

      {/* Bottom-sheet: daftar item satu meja (+ tombol Process). */}
      {openGroup && (
        <OrderDetailSheet
          group={openGroup}
          scheduled={sub === "scheduled"}
          busy={busy}
          onMarkPreparing={markPreparing}
          onMarkPreparingMany={markPreparingMany}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

type OrderTableGroup = ReturnType<typeof groupByTable>[number];

/** Kartu ringkas PER MEJA (pola QueueTableCard waiter). Klik → sheet detail. */
function OrderTableCard({
  group: t,
  scheduled,
  onOpen,
}: {
  group: OrderTableGroup;
  scheduled: boolean;
  onOpen: () => void;
}) {
  const totalQty = t.items.reduce((s, i) => s + i.quantity, 0);
  // Item paling awal di meja ini (query FIFO oldest-first) → pemesan + waktunya
  // dipakai sbg identitas kartu ("siapa yg mulai order & kapan").
  const first = t.items.reduce(
    (min, i) => (i.created_at < min.created_at ? i : min),
    t.items[0]
  );
  // Aktif: kuning kalau masih ada yg perlu dikirim ke dapur; kalau semua sudah
  // 'preparing', netral. Scheduled: biru.
  const anySent = t.items.some((i) => i.status === "sent");

  return (
    <Card
      onClick={onOpen}
      className={cn(
        "p-4 cursor-pointer transition hover:border-primary/40",
        scheduled
          ? "border-sky-500/20 bg-sky-500/[0.03]"
          : anySent
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border"
      )}
    >
      {/* Baris meja + status. */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Badge variant="default" className="text-[10px] px-1.5">
          {t.label}
        </Badge>
        <span className="text-[10px] text-muted-foreground truncate">
          {t.area}
        </span>
        {scheduled ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-sky-400">
            <Clock className="h-3 w-3" /> scheduled
          </span>
        ) : anySent ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-amber-400">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-400 relative">
              <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-75" />
            </span>
            new
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-amber-400">
            <ChefHat className="h-3 w-3" /> in kitchen
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Foto pemesan — BESAR (elemen utama kartu). */}
        <Avatar className="h-14 w-14 shrink-0 border border-border">
          {first.added_by_avatar && (
            <AvatarImage src={first.added_by_avatar} alt={first.added_by_name} />
          )}
          <AvatarFallback className="text-base">
            {initials(first.added_by_name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold">
            {orderCount(t.items)} order{orderCount(t.items) === 1 ? "" : "s"}
            <span className="text-muted-foreground font-normal">
              {" "}
              · {totalQty} item{totalQty === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-sm text-foreground/90 truncate mt-0.5">
            {first.added_by_name}
          </div>
          {scheduled && t.reservation_at ? (
            <div className="text-[11px] text-sky-400 tabular-nums mt-0.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              booking{" "}
              {usageLabel({
                reservation_at: t.reservation_at,
                reservation_end_at: null,
                started_at: t.reservation_at,
              })}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {fmtDate(first.created_at)} {fmtTime(first.created_at)}
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </Card>
  );
}

/** Bottom-sheet daftar item satu meja. Active → tombol Process (kirim ke dapur) per item;
 *  Scheduled → read-only. */
function OrderDetailSheet({
  group: t,
  scheduled,
  busy,
  onMarkPreparing,
  onMarkPreparingMany,
  onClose,
}: {
  group: OrderTableGroup;
  scheduled: boolean;
  busy: string | null;
  onMarkPreparing: (itemId: string) => void;
  onMarkPreparingMany: (itemIds: string[]) => void;
  onClose: () => void;
}) {
  // Kunci scroll body selama sheet terbuka → background tak ikut ter-scroll.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Kelompokkan per order_id, urut waktu order tertua dulu (sesuai antrean).
  const orderGroups = React.useMemo(() => {
    const map = new Map<string, CashierOrderItem[]>();
    for (const it of t.items) {
      const arr = map.get(it.order_id);
      if (arr) arr.push(it);
      else map.set(it.order_id, [it]);
    }
    return Array.from(map.entries())
      .map(([orderId, items]) => ({
        orderId,
        items,
        firstAt: items.reduce(
          (min, i) => (i.created_at < min ? i.created_at : min),
          items[0].created_at
        ),
        totalQty: items.reduce((s, i) => s + i.quantity, 0),
        pendingIds: items.filter((i) => i.status === "sent").map((i) => i.id),
      }))
      .sort((a, b) => a.firstAt.localeCompare(b.firstAt));
  }, [t.items]);

  // z-[60] di atas StaffBottomNav (portal z-50) — kalau sama-sama z-50,
  // navbar+Open Table (dirender belakangan) menutupi tombol sheet.
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[88vh] flex flex-col">
        {/* Header: meja + status + close */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-xs font-semibold text-primary shrink-0">
              {t.label}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{t.area}</div>
              <div className="flex items-center gap-1 text-[11px]">
                {scheduled ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                    <span className="text-sky-400">Scheduled</span>
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="text-emerald-400">Active table</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Ringkasan: ikon + N orders/items + waktu order pertama */}
        {(() => {
          const totalQty = t.items.reduce((s, i) => s + i.quantity, 0);
          const first = t.items.reduce(
            (min, i) => (i.created_at < min.created_at ? i : min),
            t.items[0]
          );
          return (
            <div className="flex items-center gap-3 p-4 border-b border-border shrink-0">
              <span
                className={cn(
                  "inline-flex h-12 w-12 items-center justify-center rounded-full border shrink-0",
                  scheduled
                    ? "border-sky-500/25 bg-sky-500/10 text-sky-400"
                    : "border-primary/25 bg-primary/10 text-primary"
                )}
              >
                <ShoppingBag className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-lg font-bold">
                  {orderCount(t.items)} order{orderCount(t.items) === 1 ? "" : "s"}
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                    {totalQty} item{totalQty === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums mt-0.5">
                  <Clock className="h-3 w-3" />
                  {scheduled && t.reservation_at
                    ? `booking ${usageLabel({ reservation_at: t.reservation_at, reservation_end_at: null, started_at: t.reservation_at })}`
                    : `${fmtDate(first.created_at)} ${fmtTime(first.created_at)}`}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Daftar item — SELALU dikelompokkan per order (semua item tetap
            tampil, hanya dipisah per order supaya jelas isi tiap order). */}
        <div className="p-3 overflow-y-auto [overscroll-behavior:contain] space-y-2">
          {orderGroups.map((g, gi) => (
            <div key={g.orderId} className="space-y-2">
              {/* Header per order: nomor, jam, pemesan, jumlah + aksi massal */}
              <div className="flex items-center gap-2 pt-1">
                <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-semibold">
                  Order {gi + 1}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                  <Clock className="h-3 w-3" />
                  {fmtTime(g.firstAt)}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  · {g.items[0].added_by_name} · {g.totalQty} item
                  {g.totalQty === 1 ? "" : "s"}
                </span>
                {!scheduled && g.pendingIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onMarkPreparingMany(g.pendingIds)}
                    className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/20"
                  >
                    <ChefHat className="h-3 w-3" />
                    Process all
                  </button>
                )}
              </div>
              {g.items.map((it) => (
                <OrderItemRow
                  key={it.id}
                  it={it}
                  scheduled={scheduled}
                  busy={busy}
                  onMarkPreparing={onMarkPreparing}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Footer: realtime hint */}
        <div className="border-t border-border p-3 shrink-0 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          All orders are synced in real time
        </div>
      </div>
    </div>
  );
}

/** Satu baris item order di sheet detail. */
function OrderItemRow({
  it,
  scheduled,
  busy,
  onMarkPreparing,
}: {
  it: CashierOrderItem;
  scheduled: boolean;
  busy: string | null;
  onMarkPreparing: (itemId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-2.5">
      {/* Foto menu — besar */}
      <div className="h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center">
        {it.menu_item_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={it.menu_item_image}
            alt={it.menu_item_name}
            className="h-full w-full object-cover"
          />
        ) : (
          <Utensils className="h-5 w-5 text-muted-foreground/40" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">
          <span
            className={cn(
              "tabular-nums mr-1",
              scheduled ? "text-muted-foreground" : "text-primary"
            )}
          >
            {it.quantity}×
          </span>
          {it.menu_item_name}
        </p>
        {it.notes && (
          <p className="text-[11px] italic text-amber-300/90 truncate">
            note: {it.notes}
          </p>
        )}
        {/* Pemesan */}
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <Avatar className="h-4 w-4 shrink-0">
            {it.added_by_avatar && <AvatarImage src={it.added_by_avatar} />}
            <AvatarFallback className="text-[7px]">
              {initials(it.added_by_name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-[11px] text-muted-foreground truncate">
            by {it.added_by_name}
          </span>
        </div>
        {/* Tanggal + jam order (ikon kalender & jam) */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums mt-0.5">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {fmtDate(it.created_at)}
          </span>
          <span className="text-muted-foreground/40">|</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmtTime(it.created_at)}
          </span>
        </div>
      </div>

      {/* Aksi */}
      <div className="shrink-0 flex items-center gap-1.5">
        {scheduled ? (
          <span className="text-[11px] text-sky-400">for later</span>
        ) : it.status === "preparing" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/40 px-2 py-1 text-[11px] font-medium text-amber-400">
            <ChefHat className="h-3 w-3" /> In progress
          </span>
        ) : (
          <button
            type="button"
            disabled={busy === it.id}
            onClick={() => onMarkPreparing(it.id)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50"
          >
            {busy === it.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChefHat className="h-3.5 w-3.5" />
            )}
            Process
          </button>
        )}
        {!scheduled && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
    </div>
  );
}

/** Tombol segmented sub-tab (pola waiter). */
function SubTabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

