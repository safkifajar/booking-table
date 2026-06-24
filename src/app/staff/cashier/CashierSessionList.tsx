"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  CheckCircle2,
  Clock,
  ChevronRight,
  Crown,
  Wallet,
  Sparkles,
  Layers,
  CalendarClock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatIDR, initials, cn } from "@/lib/utils";
import type {
  CashierSessionItem,
  CashierBookingItem,
} from "@/lib/cashier-actions";

interface Props {
  sessions: CashierSessionItem[];
  bookings: CashierBookingItem[];
  barId: string;
}

type Tab = "active" | "bookings";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
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
 * Cashier session list — card layout (mobile-friendly).
 *
 * Kalau nanti butuh dense view di desktop, bisa di-extend pakai
 * `hidden md:block` pattern dengan table sebagai variant. Untuk MVP,
 * card layout cocok di semua screen size karena mobile-first.
 */
export function CashierSessionList({ sessions, bookings, barId }: Props) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [tab, setTab] = React.useState<Tab>("active");

  // Realtime: subscribe SSE staff channel
  React.useEffect(() => {
    if (!barId) return;
    const es = new EventSource(`/api/realtime/staff/${barId}`);
    es.onmessage = () => router.refresh();
    es.onerror = () => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] staff:${barId} disconnected`);
      }
    };
    return () => es.close();
  }, [barId, router]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.table_label.toLowerCase().includes(q) ||
        s.host_name.toLowerCase().includes(q) ||
        (s.title ?? "").toLowerCase().includes(q) ||
        s.area_name.toLowerCase().includes(q)
    );
  }, [sessions, query]);

  // Quick stats hari ini (active sessions saja — bukan transaksi closed)
  const totalOpen = sessions.length;
  const totalUnpaid = sessions.reduce((s, x) => s + x.outstanding, 0);
  const totalPaidPartial = sessions.reduce((s, x) => s + x.paid_total, 0);

  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Meja aktif"
          value={totalOpen.toString()}
        />
        <StatCard
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Sudah bayar"
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

      {/* Tab: Meja Aktif / Booking */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border w-fit">
        <TabButton
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Meja Aktif"
          active={tab === "active"}
          onClick={() => setTab("active")}
          badge={sessions.length}
        />
        <TabButton
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Booking"
          active={tab === "bookings"}
          onClick={() => setTab("bookings")}
          badge={bookings.length}
        />
      </div>

      {tab === "active" && (
        <>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nomor meja, host, atau title..."
              className="w-full h-11 pl-10 pr-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
            />
          </div>

          {/* Session list */}
          {filtered.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <Wallet className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              {sessions.length === 0 ? (
                <>
                  <p className="text-sm font-medium mb-1">Belum ada meja aktif</p>
                  <p className="text-xs text-muted-foreground">
                    Meja akan muncul di sini setelah customer buka session.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium mb-1">Tidak ada hasil</p>
                  <p className="text-xs text-muted-foreground">
                    Coba kata kunci lain.
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
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 bg-muted text-foreground">
          {badge}
        </span>
      )}
    </button>
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
        <p className="text-sm font-medium mb-1">Belum ada booking terjadwal</p>
        <p className="text-xs text-muted-foreground">
          Reservasi yang jamnya belum tiba akan muncul di sini.
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
              {d === "all" ? "Semua" : fmtDate(d)}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground">
            Tidak ada booking di tanggal ini.
          </p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map((b) => (
            <Link key={b.session_id} href={`/staff/cashier/${b.session_id}`}>
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
      href={`/staff/cashier/${session.session_id}`}
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
              <RelativeTime
                date={session.started_at}
                className="text-[11px] whitespace-nowrap"
              />
            </div>
            {session.is_walk_in && session.opened_by_staff_name && (
              <div className="text-[10px] text-primary/70 mt-0.5 truncate">
                Dibuka oleh {session.opened_by_staff_name}
                {session.guest_names.length > 1 && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {session.guest_names.length} tamu
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
                    Lunas
                  </span>
                ) : session.paid_total > 0 ? (
                  <>
                    <span className="text-emerald-400 tabular-nums">
                      {formatIDR(session.paid_total)} terbayar
                    </span>
                    <span className="text-amber-400 tabular-nums font-medium">
                      {formatIDR(session.outstanding)} kurang
                    </span>
                  </>
                ) : (
                  <span className="text-amber-400 font-medium tabular-nums">
                    Belum dibayar
                  </span>
                )}
              </div>
            </>
          )}

          {session.subtotal === 0 && (
            <div className="text-xs text-muted-foreground italic">
              Belum ada order
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
