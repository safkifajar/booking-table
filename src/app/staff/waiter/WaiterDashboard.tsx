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
  Sparkles,
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
  staffOpenTableForCustomer,
  type WaiterQueueItem,
  type WaiterSessionItem,
  type AvailableTable,
  type WaiterReservationData,
} from "@/lib/waiter-actions";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import { formatIDR, initials, cn, getActionErrorMessage } from "@/lib/utils";

interface Props {
  initialQueue: WaiterQueueItem[];
  initialSessions: WaiterSessionItem[];
  initialAvailableTables: AvailableTable[];
  reservationData: WaiterReservationData;
  barId: string;
}

type Tab = "queue" | "sessions";

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
  barId,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab: Tab = searchParams.get("tab") === "sessions" ? "sessions" : "queue";
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border">
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

      {tab === "queue" ? (
        <QueueView
          items={visibleQueue}
          onMarkServed={handleMarkServed}
          optimisticIds={optimistic}
        />
      ) : (
        <SessionsView
          sessions={initialSessions}
          onAssist={handleAssistOrder}
          joiningSession={joiningSession}
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
            Buka Meja Baru untuk Tamu
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
}: {
  sessions: WaiterSessionItem[];
  onAssist: (id: string) => Promise<void>;
  joiningSession: string | null;
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
        <p className="text-sm font-medium mb-1">Belum ada meja aktif</p>
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

function SessionCard({
  session,
  onAssist,
  isJoining,
}: {
  session: WaiterSessionItem;
  onAssist: (id: string) => Promise<void>;
  isJoining: boolean;
}) {
  return (
    <Card className="p-4">
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

        <Button
          type="button"
          variant="gold"
          size="sm"
          className="w-full"
          onClick={() => onAssist(session.session_id)}
          disabled={isJoining}
        >
          {isJoining ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Membuka...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Bantu Pesan
            </>
          )}
        </Button>
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
      className={cn(
        "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
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

function OpenTableModal({
  tables,
  reservationData,
  onClose,
}: {
  tables: AvailableTable[];
  reservationData: WaiterReservationData;
  onClose: () => void;
}) {
  const [guestNames, setGuestNames] = React.useState<string[]>([""]);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = React.useState(false);
  // Jam booking (wajib dipilih saat buka meja).
  const [slotStart, setSlotStart] = React.useState("");
  const [slotEnd, setSlotEnd] = React.useState("");

  const reservationEnabled = reservationData.enabled && reservationData.slots.length > 0;

  const selectedTable = React.useMemo(
    () => tables.find((t) => t.id === selectedTableId) ?? null,
    [tables, selectedTableId]
  );
  const capacity = selectedTable?.capacity ?? 8;

  // Group tables by area
  const groupedTables = React.useMemo(() => {
    const map = new Map<string, AvailableTable[]>();
    for (const t of tables) {
      const list = map.get(t.area_name) ?? [];
      list.push(t);
      map.set(t.area_name, list);
    }
    return Array.from(map.entries());
  }, [tables]);

  // Trim guest list kalau pilih meja dengan capacity lebih kecil
  React.useEffect(() => {
    if (selectedTable && guestNames.length > selectedTable.capacity) {
      setGuestNames((prev) => prev.slice(0, selectedTable.capacity));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableId]);

  function updateGuestName(index: number, value: string) {
    setGuestNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function addGuest() {
    if (guestNames.length >= capacity) return;
    setGuestNames((prev) => [...prev, ""]);
  }

  function removeGuest(index: number) {
    if (guestNames.length <= 1) return;
    setGuestNames((prev) => prev.filter((_, i) => i !== index));
  }

  const validNamesCount = guestNames.filter((n) => n.trim().length > 0).length;
  // Selesai efektif (1 slot kalau baru pilih mulai) — utk kirim reservationEndAt.
  const slotMs = reservationData.slotIntervalMinutes * 60 * 1000;
  const effectiveEnd =
    slotEnd || (slotStart ? new Date(new Date(slotStart).getTime() + slotMs).toISOString() : "");
  const canSubmit =
    !submitting &&
    selectedTableId !== null &&
    validNamesCount > 0 &&
    tables.length > 0 &&
    // Wajib pilih jam KALAU reservasi aktif; kalau bar matikan reservasi → walk-in.
    (!reservationEnabled || !!slotStart);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedTableId) return;
    if (reservationEnabled && !slotStart) {
      toast.error("Pilih jam booking dulu");
      return;
    }

    setSubmitting(true);
    try {
      await staffOpenTableForCustomer(
        selectedTableId,
        guestNames,
        slotStart || null,
        slotStart ? effectiveEnd : null
      );
      // Redirect handled by server action — no toast needed
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("NEXT_REDIRECT")) throw err;
      toast.error(getActionErrorMessage(err, "Gagal buka meja"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Buka Meja untuk Tamu</h2>
              <p className="text-[11px] text-muted-foreground">
                Untuk tamu yang tidak bawa HP / walk-in
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Pilih meja DULU karena capacity-nya nentuin max tamu */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                1. Pilih meja kosong
              </label>
              {tables.length === 0 ? (
                <Card className="p-6 text-center border-dashed">
                  <p className="text-xs text-muted-foreground">
                    Semua meja sedang terpakai. Tutup salah satu dulu.
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {groupedTables.map(([area, ts]) => (
                    <div key={area}>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                        {area}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {ts.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setSelectedTableId(t.id)}
                            className={cn(
                              "p-2 rounded-md border text-center transition",
                              selectedTableId === t.id
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-muted/30 hover:border-primary/50"
                            )}
                          >
                            <div className="text-xs font-semibold">
                              {t.label}
                            </div>
                            <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5 mt-0.5">
                              <Users className="h-2.5 w-2.5" />
                              {t.capacity}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pilih jam booking (wajib) */}
            {reservationEnabled && selectedTableId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  2. Pilih jam booking
                </label>
                <SlotRangePicker
                  slots={reservationData.slots}
                  bookedSlotIsos={
                    reservationData.bookedByTable[selectedTableId] ?? []
                  }
                  slotIntervalMinutes={reservationData.slotIntervalMinutes}
                  bookingWindowDays={reservationData.bookingWindowDays}
                  startIso={slotStart}
                  endIso={slotEnd}
                  onChange={(start, end) => {
                    setSlotStart(start);
                    setSlotEnd(end);
                  }}
                />
              </div>
            )}

            {/* Daftar nama tamu — disabled kalau belum pilih meja */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  3. Nama tamu di meja
                </label>
                {selectedTable && (
                  <span className="text-[10px] text-muted-foreground">
                    {validNamesCount}/{capacity} tamu
                  </span>
                )}
              </div>

              {!selectedTable ? (
                <Card className="p-4 text-center border-dashed">
                  <p className="text-[11px] text-muted-foreground">
                    Pilih meja dulu untuk input nama tamu
                  </p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {guestNames.map((name, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="flex items-center justify-center h-9 w-7 shrink-0 rounded-md bg-muted/50 text-[10px] font-medium text-muted-foreground">
                        {index + 1}
                      </div>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => updateGuestName(index, e.target.value)}
                        placeholder={
                          index === 0
                            ? "Nama utama (tampil di bill)"
                            : `Nama tamu ${index + 1}`
                        }
                        maxLength={80}
                        autoFocus={index === 0}
                        className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-md text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                      />
                      {guestNames.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeGuest(index)}
                          className="h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive flex items-center justify-center"
                          aria-label="Hapus tamu"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {guestNames.length < capacity && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={addGuest}
                      className="w-full border border-dashed border-border text-muted-foreground hover:text-primary"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah tamu lain
                    </Button>
                  )}

                  <p className="text-[10px] text-muted-foreground mt-1">
                    Nama tamu pertama akan tampil di bill & receipt sebagai
                    pemilik meja.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 p-4 bg-background border-t border-border shrink-0">
            <Button
              type="submit"
              variant="gold"
              size="lg"
              className="w-full"
              disabled={!canSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Membuka meja...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Buka Meja & Mulai Pesan
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
