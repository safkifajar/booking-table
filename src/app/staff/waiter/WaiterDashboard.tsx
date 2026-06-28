"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Utensils,
  Layers,
  CheckCircle2,
  Volume2,
  VolumeX,
  Crown,
  Users,
  Plus,
  Clock,
  CalendarClock,
  ArrowRightLeft,
  Loader2,
  UserPlus,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  waiterMarkServed,
  waiterJoinSession,
  type WaiterQueueItem,
  type WaiterSessionItem,
  type AvailableTable,
  type WaiterReservationData,
  type WaiterBookingItem,
} from "@/lib/waiter-actions";
import { OpenTableModal } from "@/components/staff/OpenTableModal";
import {
  MoveRequestsPanel,
  countPending,
} from "@/components/staff/MoveRequestsPanel";
import type { MoveRequestRow } from "@/lib/move-approval-actions";
import { formatIDR, initials, cn, getActionErrorMessage } from "@/lib/utils";

interface Props {
  initialQueue: WaiterQueueItem[];
  initialSessions: WaiterSessionItem[];
  initialAvailableTables: AvailableTable[];
  reservationData: WaiterReservationData;
  initialBookings: WaiterBookingItem[];
  closedSessions: WaiterSessionItem[];
  moveRequests: MoveRequestRow[];
  barId: string;
}

type Tab = "queue" | "sessions" | "bookings" | "moves" | "done";

const AUDIO_PREF_KEY = "waiter_audio_enabled";

/** "22 Jun" — tanggal ringkas. */
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
/** "21:00" — jam:menit. */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}
/**
 * Label waktu sesi: kalau dari reservasi → "22 Jun · 21:00–23:00".
 * Walk-in (tanpa reservation) → "22 Jun · 20:36" dari started_at.
 */
function sessionWhen(s: WaiterSessionItem): string {
  if (s.reservation_at) {
    const end = s.reservation_end_at ? `–${fmtTime(s.reservation_end_at)}` : "";
    return `${fmtDate(s.reservation_at)} · ${fmtTime(s.reservation_at)}${end}`;
  }
  return `${fmtDate(s.started_at)} · ${fmtTime(s.started_at)}`;
}

export function WaiterDashboard({
  initialQueue,
  initialSessions,
  initialAvailableTables,
  reservationData,
  initialBookings,
  closedSessions,
  moveRequests,
  barId,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: Tab =
    tabParam === "sessions"
      ? "sessions"
      : tabParam === "bookings"
        ? "bookings"
        : tabParam === "moves"
          ? "moves"
          : tabParam === "done"
            ? "done"
            : "queue";
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const [audioEnabled, setAudioEnabled] = React.useState(true);
  const [optimistic, setOptimistic] = React.useState<Set<string>>(new Set());
  const [joiningSession, setJoiningSession] = React.useState<string | null>(null);
  const [openTableModal, setOpenTableModal] = React.useState(false);

  // Load audio preference dari localStorage
  React.useEffect(() => {
    const stored = localStorage.getItem(AUDIO_PREF_KEY);
    if (stored !== null) setAudioEnabled(stored === "true");
  }, []);

  function toggleAudio() {
    const next = !audioEnabled;
    setAudioEnabled(next);
    localStorage.setItem(AUDIO_PREF_KEY, String(next));
    // Play beep saat enable supaya browser register user gesture untuk
    // izinkan Web Audio API (autoplay policy), plus konfirmasi audio jalan.
    if (next) {
      playBeep();
    }
    toast.success(next ? "Suara notifikasi nyala" : "Suara notifikasi mati");
  }

  // Play beep when new "sent" items arrive (queue length increases)
  const lastQueueCountRef = React.useRef(initialQueue.length);
  React.useEffect(() => {
    if (initialQueue.length > lastQueueCountRef.current && audioEnabled) {
      playBeep();
    }
    lastQueueCountRef.current = initialQueue.length;
  }, [initialQueue.length, audioEnabled]);

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

  // Apply optimistic state — filter out items marked served
  const visibleQueue = React.useMemo(
    () => initialQueue.filter((q) => !optimistic.has(q.id)),
    [initialQueue, optimistic]
  );

  // Reset optimistic state when initialQueue changes (server confirmed)
  React.useEffect(() => {
    setOptimistic((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) {
        if (initialQueue.find((q) => q.id === id)) {
          next.add(id);
        }
      }
      return next;
    });
  }, [initialQueue]);

  async function handleMarkServed(itemId: string) {
    setOptimistic((prev) => new Set(prev).add(itemId));
    try {
      await waiterMarkServed(itemId);
      toast.success("Pesanan diantar");
    } catch (err) {
      // Rollback
      setOptimistic((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      toast.error(getActionErrorMessage(err, "Gagal mark served"));
    }
  }

  async function handleAssistOrder(sessionId: string) {
    setJoiningSession(sessionId);
    try {
      await waiterJoinSession(sessionId);
      // Tidak perlu toast — redirect ke /session/[id] yang lebih kuat sebagai feedback
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // NEXT_REDIRECT lempar ulang — biarkan Next.js handle
      if (message.includes("NEXT_REDIRECT")) throw err;
      toast.error(getActionErrorMessage(err, "Gagal bantu pesan"));
      setJoiningSession(null);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Tab strip + audio toggle */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex gap-1 p-1 rounded-lg bg-muted/40 border border-border overflow-x-auto">
          <TabButton
            icon={<Utensils className="h-3.5 w-3.5" />}
            label="Order Masuk"
            active={tab === "queue"}
            onClick={() => setTab("queue")}
            badge={visibleQueue.length}
            alert={visibleQueue.length > 0}
          />
          <TabButton
            icon={<Layers className="h-3.5 w-3.5" />}
            label="Meja Aktif"
            active={tab === "sessions"}
            onClick={() => setTab("sessions")}
            badge={initialSessions.length}
          />
          <TabButton
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="Booking"
            active={tab === "bookings"}
            onClick={() => setTab("bookings")}
            badge={initialBookings.length}
          />
          <TabButton
            icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
            label="Pindah Meja"
            active={tab === "moves"}
            onClick={() => setTab("moves")}
            badge={countPending(moveRequests)}
            alert={countPending(moveRequests) > 0}
          />
          <TabButton
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label="Selesai"
            active={tab === "done"}
            onClick={() => setTab("done")}
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggleAudio}
          className={cn(
            "shrink-0",
            audioEnabled ? "text-primary" : "text-muted-foreground"
          )}
          title={audioEnabled ? "Matikan suara" : "Nyalakan suara"}
        >
          {audioEnabled ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
        </Button>
      </div>

      {tab === "queue" && (
        <QueueView
          items={visibleQueue}
          onMarkServed={handleMarkServed}
          optimisticIds={optimistic}
        />
      )}
      {tab === "sessions" && (
        <SessionsView
          sessions={initialSessions}
          onAssist={handleAssistOrder}
          joiningSession={joiningSession}
        />
      )}
      {tab === "bookings" && <BookingsView bookings={initialBookings} />}

      {tab === "moves" && <MoveRequestsPanel requests={moveRequests} />}

      {tab === "done" && (
        <SessionsView
          sessions={closedSessions}
          onAssist={handleAssistOrder}
          joiningSession={joiningSession}
          emptyLabel="Belum ada sesi selesai"
        />
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
            disabled={initialAvailableTables.length === 0}
          >
            <UserPlus className="h-4 w-4" />
            Buka Meja
            {initialAvailableTables.length > 0 && (
              <span className="ml-1 text-xs opacity-70">
                ({initialAvailableTables.length} meja kosong)
              </span>
            )}
          </Button>
        </div>
      </div>

      {openTableModal && (
        <OpenTableModal
          tables={initialAvailableTables}
          reservationData={reservationData}
          onClose={() => setOpenTableModal(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// TAB: ORDER QUEUE
// ============================================================

function QueueView({
  items,
  onMarkServed,
  optimisticIds,
}: {
  items: WaiterQueueItem[];
  onMarkServed: (id: string) => Promise<void>;
  optimisticIds: Set<string>;
}) {
  if (items.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500/40 mb-3" />
        <p className="text-sm font-medium mb-1">Tidak ada pesanan baru</p>
        <p className="text-xs text-muted-foreground">
          Semua pesanan sudah diantar. Mantap!
        </p>
      </Card>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {items.map((item) => (
        <QueueItemCard
          key={item.id}
          item={item}
          onMarkServed={onMarkServed}
          optimistic={optimisticIds.has(item.id)}
        />
      ))}
    </div>
  );
}

function QueueItemCard({
  item,
  onMarkServed,
  optimistic,
}: {
  item: WaiterQueueItem;
  onMarkServed: (id: string) => Promise<void>;
  optimistic: boolean;
}) {
  const [loading, setLoading] = React.useState(false);

  async function handle() {
    setLoading(true);
    try {
      await onMarkServed(item.id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className={cn(
        "p-4 border-amber-500/30 bg-amber-500/5 transition",
        optimistic && "opacity-50"
      )}
    >
      <div className="flex items-start gap-3 mb-3">
        {/* Pulse dot kalau baru */}
        <div className="shrink-0 mt-1">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 relative">
            {!optimistic && (
              <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-75" />
            )}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          {/* Meja + area */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="default" className="text-[10px] px-1.5">
              {item.table_label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {item.area_name}
            </span>
            {item.session_title && (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                  {item.session_title}
                </span>
              </>
            )}
          </div>

          {/* Item name */}
          <h3 className="font-semibold text-sm">
            {item.quantity > 1 && (
              <span className="text-primary mr-1">{item.quantity}×</span>
            )}
            {item.menu_item_name}
          </h3>

          {item.notes && (
            <p className="text-xs text-amber-300/90 mt-0.5 italic">
              note: {item.notes}
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            <RelativeTime date={item.created_at} className="text-[10px]" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar className="h-5 w-5">
            {item.added_by_avatar && (
              <AvatarImage src={item.added_by_avatar} />
            )}
            <AvatarFallback className="text-[8px]">
              {initials(item.added_by_name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-[11px] text-muted-foreground truncate">
            by {item.added_by_name}
          </span>
        </div>
        <Button
          variant="gold"
          size="sm"
          onClick={handle}
          disabled={loading || optimistic}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Sudah diantar
        </Button>
      </div>
    </Card>
  );
}

// ============================================================
// TAB: SESSIONS (Bantu Pesan)
// ============================================================

/** Kunci tanggal sesi (reservation_at kalau ada, else started_at) → "YYYY-MM-DD". */
function sessionDateKey(s: WaiterSessionItem): string {
  const d = new Date(s.reservation_at ?? s.started_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function SessionsView({
  sessions,
  onAssist,
  joiningSession,
  emptyLabel = "Belum ada meja aktif",
}: {
  sessions: WaiterSessionItem[];
  onAssist: (id: string) => Promise<void>;
  joiningSession: string | null;
  emptyLabel?: string;
}) {
  const [dateFilter, setDateFilter] = React.useState<string>("all");

  // Tanggal unik (urut) dari sesi, untuk tab filter.
  const dates = React.useMemo(() => {
    const set = new Set(sessions.map(sessionDateKey));
    return Array.from(set).sort();
  }, [sessions]);

  const filtered =
    dateFilter === "all"
      ? sessions
      : sessions.filter((s) => sessionDateKey(s) === dateFilter);

  if (sessions.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium mb-1">{emptyLabel}</p>
        <p className="text-xs text-muted-foreground">
          Meja yang sudah dibuka customer akan muncul di sini.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tab tanggal — filter sesi per tanggal booking */}
      {dates.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <DateChip
            label="Semua"
            active={dateFilter === "all"}
            onClick={() => setDateFilter("all")}
          />
          {dates.map((d) => (
            <DateChip
              key={d}
              label={fmtDate(d)}
              active={dateFilter === d}
              onClick={() => setDateFilter(d)}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground">
            Tidak ada meja di tanggal ini.
          </p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map((s) => (
            <SessionCard
              key={s.session_id}
              session={s}
              onAssist={onAssist}
              isJoining={joiningSession === s.session_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DateChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition whitespace-nowrap",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
      )}
    >
      {label}
    </button>
  );
}

/** Kunci tanggal booking → "YYYY-MM-DD". */
function bookingDateKey(b: WaiterBookingItem): string {
  const d = new Date(b.reservation_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// TAB: BOOKING (reservasi terjadwal)
function BookingsView({ bookings }: { bookings: WaiterBookingItem[] }) {
  const [dateFilter, setDateFilter] = React.useState<string>("all");

  const dates = React.useMemo(() => {
    const set = new Set(bookings.map(bookingDateKey));
    return Array.from(set).sort();
  }, [bookings]);

  const filtered =
    dateFilter === "all"
      ? bookings
      : bookings.filter((b) => bookingDateKey(b) === dateFilter);

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
          <DateChip
            label="Semua"
            active={dateFilter === "all"}
            onClick={() => setDateFilter("all")}
          />
          {dates.map((d) => (
            <DateChip
              key={d}
              label={fmtDate(d)}
              active={dateFilter === d}
              onClick={() => setDateFilter(d)}
            />
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
            <Link
              key={b.session_id}
              href={`/session/${b.session_id}`}
              className="block"
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
                    {b.reservation_end_at &&
                      `–${fmtTime(b.reservation_end_at)}`}
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

function SessionCard({
  session,
  onAssist,
  isJoining,
}: {
  session: WaiterSessionItem;
  onAssist: (id: string) => Promise<void>;
  isJoining: boolean;
}) {
  const router = useRouter();
  // open → bantu pesan (join). Selain itu (overdue/locked) → buka sesi langsung
  // supaya staff tetap bisa lihat bill & close/terima bayar.
  function handleClick() {
    if (isJoining) return;
    if (session.status === "open") {
      void onAssist(session.session_id);
    } else {
      router.push(`/session/${session.session_id}`);
    }
  }
  return (
    <Card
      onClick={handleClick}
      className={cn(
        "p-4 cursor-pointer transition hover:border-primary/40 hover:bg-primary/[0.03]",
        isJoining && "opacity-60 pointer-events-none"
      )}
    >
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
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge variant="default" className="text-[10px] px-1.5">
              {session.table_label}
            </Badge>
            <span className="text-[10px] text-muted-foreground truncate">
              {session.area_name}
            </span>
          </div>
          <div className="text-sm font-medium truncate">
            {session.title ?? "Open Table"}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            <span className="inline-flex items-center gap-0.5">
              <Crown className="h-2.5 w-2.5" />
              {session.host_name}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-0.5">
              <Users className="h-2.5 w-2.5" />
              {session.member_count}/{session.table_capacity}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            <span>{sessionWhen(session)}</span>
          </div>
        </div>
      </div>

      {/* Bill summary */}
      <div className="pt-3 border-t border-border space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Running bill</span>
          <span className="font-semibold tabular-nums">
            {session.subtotal > 0 ? formatIDR(session.subtotal) : (
              <span className="text-muted-foreground italic font-normal">—</span>
            )}
          </span>
        </div>

        {session.subtotal > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Status bayar</span>
            {session.is_paid ? (
              <Badge
                variant="default"
                className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] gap-1"
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                Lunas
              </Badge>
            ) : (
              <Badge
                variant="default"
                className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px] gap-1"
              >
                <Clock className="h-2.5 w-2.5" />
                Sisa {formatIDR(session.outstanding)}
              </Badge>
            )}
          </div>
        )}

        {/* Indikator loading saat membuka (kartu diklik = bantu pesan) */}
        {isJoining && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-primary pt-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Membuka...
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// SHARED
// ============================================================

function TabButton({
  icon,
  label,
  active,
  onClick,
  badge,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition shrink-0",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {/* Label disembunyikan di layar sangat kecil utk tab non-aktif → icon-only,
          tab aktif tetap tampil label. */}
      <span className={cn(active ? "inline" : "hidden sm:inline")}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {badge}
        </span>
      )}
      {alert && (
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
      )}
    </button>
  );
}

// ============================================================
// OPEN TABLE MODAL (Walk-in customer tanpa HP)
// ============================================================


// ============================================================
// AUDIO BEEP
// ============================================================

/**
 * Play a short notification beep using Web Audio API.
 * Tidak perlu file audio — pure synthesized tone.
 */
function playBeep() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.frequency.value = 880; // A5 — clear & not too sharp
    oscillator.type = "sine";

    // Quick fade out untuk gentle beep (300ms)
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    oscillator.start(now);
    oscillator.stop(now + 0.3);

    // Auto-close context setelah selesai supaya tidak leak
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch {
    // Browser tidak support / autoplay blocked — silent fail
  }
}
