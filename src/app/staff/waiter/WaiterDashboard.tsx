"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Utensils,
  Layers,
  CheckCircle2,
  Crown,
  Users,
  Plus,
  Clock,
  CalendarClock,
  ArrowRightLeft,
  Loader2,
  UserPlus,
  X,
  ChevronRight,
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
  type WaiterServedItem,
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
import {
  SessionListFilters,
  filterSessions,
  currentMonthRange,
  type SessionFilterState,
} from "@/components/staff/SessionListFilters";
import { StaffBottomNav } from "@/components/staff/StaffBottomNav";
import type { MoveRequestRow } from "@/lib/move-approval-actions";
import { formatIDR, initials, cn, getActionErrorMessage } from "@/lib/utils";

interface Props {
  initialQueue: WaiterQueueItem[];
  initialServed: WaiterServedItem[];
  initialSessions: WaiterSessionItem[];
  initialAvailableTables: AvailableTable[];
  reservationData: WaiterReservationData;
  initialBookings: WaiterBookingItem[];
  closedSessions: WaiterSessionItem[];
  moveRequests: MoveRequestRow[];
  barId: string;
}

type Tab = "queue" | "sessions" | "bookings" | "moves" | "done";

/** "22 Jun" — tanggal ringkas. */
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
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
  initialServed,
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
  const [optimistic, setOptimistic] = React.useState<Set<string>>(new Set());
  const [joiningSession, setJoiningSession] = React.useState<string | null>(null);
  const [openTableModal, setOpenTableModal] = React.useState(false);

  // Beep saat ada order 'sent' baru masuk (queue bertambah). Toggle sound
  // dihapus — bunyi notifikasi selalu aktif.
  const lastQueueCountRef = React.useRef(initialQueue.length);
  React.useEffect(() => {
    if (initialQueue.length > lastQueueCountRef.current) {
      playBeep();
    }
    lastQueueCountRef.current = initialQueue.length;
  }, [initialQueue.length]);

  // Realtime: subscribe SSE staff channel
  React.useEffect(() => {
    if (!barId) return;
    const es = new EventSource(`/api/realtime/staff/${barId}`);
    // Debounce: event beruntun → 1 refresh (hindari badai re-render multi-tab).
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
      toast.success("Order served");
    } catch (err) {
      // Rollback
      setOptimistic((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      toast.error(getActionErrorMessage(err, "Failed to mark served"));
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
      toast.error(getActionErrorMessage(err, "Failed to assist order"));
      setJoiningSession(null);
    }
  }

  return (
    // Flex column setinggi sisa layar → tab content scroll sendiri di dalamnya
    // (filter/search di tiap view fix, tak ikut scroll — spt kasir).
    <div className="flex flex-col h-[calc(100dvh-5.5rem)] -mb-6">
      <StaffBottomNav
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        topSlot={
          <Button
            type="button"
            variant="gold"
            size="lg"
            className="w-full"
            onClick={() => setOpenTableModal(true)}
            disabled={initialAvailableTables.length === 0}
          >
            <UserPlus className="h-4 w-4" />
            Open Table
            {initialAvailableTables.length > 0 && (
              <span className="ml-1 text-xs opacity-70">
                ({initialAvailableTables.length} tables free)
              </span>
            )}
          </Button>
        }
        tabs={[
          {
            key: "queue",
            label: "Orders",
            icon: <Utensils className="h-5 w-5" />,
            badge: visibleQueue.length,
            alert: visibleQueue.length > 0,
          },
          {
            key: "sessions",
            label: "Active",
            icon: <Layers className="h-5 w-5" />,
            badge: initialSessions.length,
          },
          {
            key: "bookings",
            label: "Bookings",
            icon: <CalendarClock className="h-5 w-5" />,
            badge: initialBookings.length,
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

      {/* Area konten tab — flex-1 min-h-0 supaya view di dalamnya bisa atur
          scroll sendiri (filter fix + list scroll). pt-6 (page.tsx py-6 sudah
          -mb-6 di root). */}
      <div className="flex-1 min-h-0 flex flex-col pt-2">
        {tab === "queue" && (
          <ScrollArea>
            <QueueView
              items={visibleQueue}
              servedItems={initialServed}
              onMarkServed={handleMarkServed}
              optimisticIds={optimistic}
            />
          </ScrollArea>
        )}
        {tab === "sessions" && (
          <SessionsView
            sessions={initialSessions}
            onAssist={handleAssistOrder}
            joiningSession={joiningSession}
          />
        )}
        {tab === "bookings" && (
          <ScrollArea>
            <BookingsView bookings={initialBookings} />
          </ScrollArea>
        )}
        {tab === "moves" && (
          <ScrollArea>
            <MoveRequestsPanel requests={moveRequests} />
          </ScrollArea>
        )}
        {tab === "done" && (
          <SessionsView
            sessions={closedSessions}
            onAssist={handleAssistOrder}
            joiningSession={joiningSession}
            emptyLabel="No completed sessions yet"
          />
        )}
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
  servedItems,
  onMarkServed,
  optimisticIds,
}: {
  items: WaiterQueueItem[];
  servedItems: WaiterServedItem[];
  onMarkServed: (id: string) => Promise<void>;
  optimisticIds: Set<string>;
}) {
  // Sub-tab monitor: yang BELUM diantar vs yang SUDAH diantar hari ini.
  const [sub, setSub] = React.useState<"pending" | "served">("pending");
  // Bottom sheet detail menu per meja (bukan dropdown — feedback user).
  const [sheet, setSheet] = React.useState<{
    sessionId: string;
    kind: "pending" | "served";
  } | null>(null);

  const pendingGroups = React.useMemo(() => {
    const m = new Map<string, WaiterQueueItem[]>();
    for (const item of items) {
      const list = m.get(item.session_id);
      if (list) list.push(item);
      else m.set(item.session_id, [item]);
    }
    return m;
  }, [items]);

  const servedGroups = React.useMemo(() => {
    const m = new Map<string, WaiterServedItem[]>();
    for (const item of servedItems) {
      const list = m.get(item.session_id);
      if (list) list.push(item);
      else m.set(item.session_id, [item]);
    }
    return m;
  }, [servedItems]);

  // Sheet meja pending yang semua itemnya keburu served → tutup otomatis.
  React.useEffect(() => {
    if (sheet?.kind === "pending" && !pendingGroups.has(sheet.sessionId)) {
      setSheet(null);
    }
  }, [sheet, pendingGroups]);

  const sheetItems: WaiterQueueItem[] = sheet
    ? sheet.kind === "pending"
      ? (pendingGroups.get(sheet.sessionId) ?? [])
      : (servedGroups.get(sheet.sessionId) ?? [])
    : [];

  return (
    <div className="space-y-3">
      {/* Sub-tab chips */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setSub("pending")}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-xs font-medium border transition",
            sub === "pending"
              ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
              : "border-border text-muted-foreground hover:border-foreground/30"
          )}
        >
          To Serve ({pendingGroups.size})
        </button>
        <button
          type="button"
          onClick={() => setSub("served")}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-xs font-medium border transition",
            sub === "served"
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
              : "border-border text-muted-foreground hover:border-foreground/30"
          )}
        >
          Served Today ({servedGroups.size})
        </button>
      </div>

      {sub === "pending" &&
        (pendingGroups.size === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500/40 mb-3" />
            <p className="text-sm font-medium mb-1">No new orders</p>
            <p className="text-xs text-muted-foreground">
              All orders have been served. Nice!
            </p>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3 items-start">
            {Array.from(pendingGroups.values()).map((groupItems) => (
              <QueueTableCard
                key={groupItems[0].session_id}
                items={groupItems}
                kind="pending"
                onOpen={() =>
                  setSheet({
                    sessionId: groupItems[0].session_id,
                    kind: "pending",
                  })
                }
              />
            ))}
          </div>
        ))}

      {sub === "served" &&
        (servedGroups.size === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <Utensils className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium mb-1">Nothing served yet today</p>
            <p className="text-xs text-muted-foreground">
              Orders you mark as served will appear here.
            </p>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3 items-start">
            {Array.from(servedGroups.values()).map((groupItems) => (
              <QueueTableCard
                key={groupItems[0].session_id}
                items={groupItems}
                kind="served"
                onOpen={() =>
                  setSheet({
                    sessionId: groupItems[0].session_id,
                    kind: "served",
                  })
                }
              />
            ))}
          </div>
        ))}

      {/* Bottom sheet: daftar menu meja terpilih */}
      {sheet && sheetItems.length > 0 && (
        <QueueDetailSheet
          items={sheetItems}
          kind={sheet.kind}
          onMarkServed={onMarkServed}
          optimisticIds={optimisticIds}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** Kartu PER MEJA (ringkas). Klik → bottom sheet daftar menu. */
function QueueTableCard({
  items,
  kind,
  onOpen,
}: {
  items: WaiterQueueItem[];
  kind: "pending" | "served";
  onOpen: () => void;
}) {
  const first = items[0];
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
  const pending = kind === "pending";

  return (
    <Card
      onClick={onOpen}
      className={cn(
        "p-4 cursor-pointer transition hover:border-primary/40",
        pending
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-emerald-500/20 bg-emerald-500/[0.03]"
      )}
    >
      <div className="flex items-center gap-3">
        {pending ? (
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 relative shrink-0">
            <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-75" />
          </span>
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="default" className="text-[10px] px-1.5">
              {first.table_label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {first.area_name}
            </span>
            {first.session_title && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                · {first.session_title}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold mt-0.5">
            {items.length} order{items.length === 1 ? "" : "s"}
            <span className="text-muted-foreground font-normal">
              {" "}
              · {totalQty} item{totalQty === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
            <Clock className="h-2.5 w-2.5" />
            {pending ? (
              <>
                oldest{" "}
                <RelativeTime date={first.created_at} className="text-[10px]" />
              </>
            ) : (
              <>
                last served{" "}
                <RelativeTime
                  date={(items[0] as WaiterServedItem).served_at}
                  className="text-[10px]"
                />
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </Card>
  );
}

/** Bottom sheet: daftar menu yang dipesan satu meja. */
function QueueDetailSheet({
  items,
  kind,
  onMarkServed,
  optimisticIds,
  onClose,
}: {
  items: WaiterQueueItem[];
  kind: "pending" | "served";
  onMarkServed: (id: string) => Promise<void>;
  optimisticIds: Set<string>;
  onClose: () => void;
}) {
  const first = items[0];

  // Kunci scroll background selama sheet terbuka.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Portal + z-[100]: StaffBottomNav (tombol Open Table) fixed z-50 dan
  // di-portal ke akhir body — tanpa ini sheet tertimpa bar tsb.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header sheet */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="default" className="text-[10px] px-1.5 shrink-0">
              {first.table_label}
            </Badge>
            <span className="text-xs text-muted-foreground truncate">
              {first.area_name}
              {first.session_title && ` · ${first.session_title}`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Daftar menu — scroll internal */}
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/60">
          {items.map((item) => (
            <QueueMenuRow
              key={item.id}
              item={item}
              served={kind === "served"}
              onMarkServed={onMarkServed}
              optimistic={optimisticIds.has(item.id)}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Baris satu menu di dalam bottom sheet. */
function QueueMenuRow({
  item,
  served,
  onMarkServed,
  optimistic,
}: {
  item: WaiterQueueItem;
  served: boolean;
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
    <div
      className={cn(
        "px-4 py-3 flex items-center gap-3 transition",
        optimistic && "opacity-50"
      )}
    >
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm">
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
        <div className="flex items-center gap-1.5 mt-1 min-w-0">
          <Avatar className="h-4 w-4">
            {item.added_by_avatar && <AvatarImage src={item.added_by_avatar} />}
            <AvatarFallback className="text-[7px]">
              {initials(item.added_by_name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-[10px] text-muted-foreground truncate">
            by {item.added_by_name}
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <RelativeTime
            date={
              served
                ? ((item as WaiterServedItem).served_at ?? item.created_at)
                : item.created_at
            }
            className="text-[10px] text-muted-foreground"
          />
        </div>
      </div>
      {served ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Served
        </span>
      ) : (
        <Button
          variant="gold"
          size="sm"
          onClick={handle}
          disabled={loading || optimistic}
          className="shrink-0"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Served
        </Button>
      )}
    </div>
  );
}

// ============================================================
// TAB: SESSIONS (Bantu Pesan)
// ============================================================

/** Kontainer scroll internal utk tab tanpa filter (queue/bookings/moves).
 *  Full-bleed scrollbar + ruang bawah utk footer Open Table+nav. */
function ScrollArea({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 sm:-mx-6 px-4 sm:px-6 pb-[calc(13rem+env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}

function SessionsView({
  sessions,
  onAssist,
  joiningSession,
  emptyLabel = "No active tables yet",
}: {
  sessions: WaiterSessionItem[];
  onAssist: (id: string) => Promise<void>;
  joiningSession: string | null;
  emptyLabel?: string;
}) {
  // Default rentang = bulan berjalan; user bisa "Semua tanggal" utk lihat semua.
  const [filter, setFilter] = React.useState<SessionFilterState>(() => ({
    ...currentMonthRange(),
    pay: "all",
  }));
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(
    () => filterSessions(sessions, { ...filter, query }),
    [sessions, filter, query]
  );

  if (sessions.length === 0) {
    return (
      <ScrollArea>
        <Card className="p-12 text-center border-dashed">
          <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">{emptyLabel}</p>
          <p className="text-xs text-muted-foreground">
            Tables opened by customers will appear here.
          </p>
        </Card>
      </ScrollArea>
    );
  }

  // Filter/search DIAM (shrink-0) di atas; hanya list yg scroll internal.
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 pb-3">
        <SessionListFilters
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 sm:-mx-6 px-4 sm:px-6 pb-[calc(13rem+env(safe-area-inset-bottom))]">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <p className="text-sm text-muted-foreground">
              No tables in this filter.
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
          <DateChip
            label="All"
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
            No bookings on this date.
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
  const paidPercentage =
    session.subtotal > 0
      ? Math.min(100, Math.round((session.paid_total / session.subtotal) * 100))
      : 0;
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

      {/* Bill summary — disamakan dengan kartu kasir (progress bar + status). */}
      <div className="pt-3 border-t border-border space-y-2">
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

        {/* Indikator loading saat membuka (kartu diklik = bantu pesan) */}
        {isJoining && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-primary pt-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Opening...
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// SHARED
// ============================================================

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
