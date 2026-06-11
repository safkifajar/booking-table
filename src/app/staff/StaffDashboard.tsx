"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Clock,
  CheckCircle2,
  ChefHat,
  Users,
  Receipt,
  Eye,
  Utensils,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { markOrderItemStatus } from "@/lib/actions";
import { initials, formatIDR, cn, getActionErrorMessage } from "@/lib/utils";

interface QueueItem {
  id: string;
  quantity: number;
  notes: string | null;
  status: "sent" | "preparing";
  created_at: string;
  queue_number: number | null;
  menu_item: { name: string; prep_minutes: number };
  added_by: { display_name: string; avatar_url: string | null };
  table: { label: string; area_name: string };
  session_id: string;
  session_title: string | null;
}

interface ActiveTable {
  session_id: string;
  table_label: string;
  area_name: string;
  title: string | null;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  table_capacity: number;
  started_at: string;
  subtotal: number;
  item_count: number;
}

interface Props {
  initialQueue: QueueItem[];
  initialTables: ActiveTable[];
  barId: string;
}

type Tab = "queue" | "tables";

export function StaffDashboard({ initialQueue, initialTables, barId }: Props) {
  const [tab, setTab] = React.useState<Tab>("queue");
  const router = useRouter();

  // Optimistic state: ganti status item segera saat tombol diklik supaya UI
  // langsung pindah, sebelum server confirm. Map item id → optimistic status
  // ("preparing", "served"). Item "served" akan disembunyikan dari queue.
  const [optimistic, setOptimistic] = React.useState<
    Map<string, "preparing" | "served">
  >(new Map());

  const setItemStatus = React.useCallback(
    (itemId: string, status: "preparing" | "served") => {
      setOptimistic((prev) => {
        const next = new Map(prev);
        next.set(itemId, status);
        return next;
      });
    },
    []
  );

  const revertItemStatus = React.useCallback((itemId: string) => {
    setOptimistic((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  // Apply optimistic state ke initialQueue, lalu filter yang sudah "served"
  const queue = React.useMemo(() => {
    return initialQueue
      .map((item) => {
        const o = optimistic.get(item.id);
        if (!o) return item;
        return { ...item, status: o };
      })
      .filter((item) => item.status !== "served") as QueueItem[];
  }, [initialQueue, optimistic]);

  // Reset optimistic state setiap initialQueue berubah (after router.refresh)
  // Items yang masih di initialQueue tapi server sudah update → optimistic match.
  React.useEffect(() => {
    setOptimistic((prev) => {
      if (prev.size === 0) return prev;
      // Hapus optimistic untuk item yang sudah tidak ada di queue (= server confirm served)
      // atau yang server status-nya sudah match.
      const next = new Map(prev);
      for (const [id, status] of prev) {
        const serverItem = initialQueue.find((q) => q.id === id);
        if (!serverItem) {
          // Server sudah remove (served), clean up
          next.delete(id);
        } else if (serverItem.status === status) {
          // Sudah sync
          next.delete(id);
        }
      }
      return next;
    });
  }, [initialQueue]);

  // Realtime via SSE → /api/realtime/staff/[barId]. Server Actions trigger
  // Postgres NOTIFY → endpoint stream → router.refresh().
  React.useEffect(() => {
    if (!barId) return;
    const es = new EventSource(`/api/realtime/staff/${barId}`);
    es.onmessage = () => router.refresh();
    es.onerror = () => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] staff:${barId} disconnected, retrying...`);
      }
    };
    return () => es.close();
  }, [barId, router]);

  const sentCount = queue.filter((q) => q.status === "sent").length;
  const preparingCount = queue.filter((q) => q.status === "preparing").length;

  return (
    <>
      {/* Tab strip */}
      <div className="sticky top-[57px] z-20 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-5xl mx-auto px-2 flex">
          <TabButton
            icon={<Utensils className="h-4 w-4" />}
            label="Order Queue"
            active={tab === "queue"}
            onClick={() => setTab("queue")}
            badge={sentCount + preparingCount}
            alert={sentCount > 0}
          />
          <TabButton
            icon={<Layers className="h-4 w-4" />}
            label="Active Tables"
            active={tab === "tables"}
            onClick={() => setTab("tables")}
            badge={initialTables.length}
          />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {tab === "queue" && (
          <QueueView
            items={queue}
            onOptimistic={setItemStatus}
            onRevert={revertItemStatus}
          />
        )}
        {tab === "tables" && <TablesView tables={initialTables} />}
      </div>
    </>
  );
}

// ============================================================
// TAB: ORDER QUEUE
// ============================================================
function QueueView({
  items,
  onOptimistic,
  onRevert,
}: {
  items: QueueItem[];
  onOptimistic: (id: string, status: "preparing" | "served") => void;
  onRevert: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="p-8 text-center border-dashed">
        <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500/50 mb-2" />
        <p className="text-sm font-medium">Tidak ada antrian</p>
        <p className="text-xs text-muted-foreground mt-1">
          Semua pesanan sudah disajikan. Mantap!
        </p>
      </Card>
    );
  }

  // Group: sent (new) at top, then preparing
  const sent = items.filter((i) => i.status === "sent");
  const preparing = items.filter((i) => i.status === "preparing");

  return (
    <div className="space-y-6">
      {sent.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-400 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Baru masuk ({sent.length})
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {sent.map((item) => (
              <QueueItemCard
                key={item.id}
                item={item}
                onOptimistic={onOptimistic}
                onRevert={onRevert}
              />
            ))}
          </div>
        </section>
      )}

      {preparing.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-primary mb-3 flex items-center gap-2">
            <ChefHat className="h-4 w-4" />
            Sedang disiapkan ({preparing.length})
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {preparing.map((item) => (
              <QueueItemCard
                key={item.id}
                item={item}
                onOptimistic={onOptimistic}
                onRevert={onRevert}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QueueItemCard({
  item,
  onOptimistic,
  onRevert,
}: {
  item: QueueItem;
  onOptimistic: (id: string, status: "preparing" | "served") => void;
  onRevert: (id: string) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const isNew = item.status === "sent";

  async function handleAction() {
    const newStatus = isNew ? "preparing" : "served";
    const queueLabel = item.queue_number
      ? `#${String(item.queue_number).padStart(3, "0")}`
      : item.menu_item.name;
    // Optimistic: langsung ubah UI sebelum server confirm
    onOptimistic(item.id, newStatus);
    setLoading(true);
    try {
      await markOrderItemStatus(item.id, newStatus);
      toast.success(
        isNew ? `Antrian ${queueLabel} mulai disiapkan` : `Antrian ${queueLabel} diantar`
      );
    } catch (err) {
      // Rollback kalau gagal
      onRevert(item.id);
      toast.error(getActionErrorMessage(err, "Gagal update status"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className={cn(
        "p-4 transition-colors",
        isNew
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-primary/30 bg-primary/5"
      )}
    >
      <div className="flex items-start gap-3 mb-3">
        {/* Queue number — visual anchor */}
        {item.queue_number !== null && (
          <div
            className={cn(
              "shrink-0 rounded-lg border px-2.5 py-1.5 text-center min-w-[52px]",
              isNew
                ? "border-amber-500/40 bg-amber-500/15"
                : "border-primary/40 bg-primary/15"
            )}
            aria-label={`Antrian nomor ${item.queue_number}`}
          >
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
              Antri
            </div>
            <div
              className={cn(
                "font-bold leading-none text-lg",
                isNew ? "text-amber-300" : "text-primary"
              )}
            >
              #{String(item.queue_number).padStart(3, "0")}
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="default" className="text-[10px]">
              {item.table.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {item.table.area_name}
            </span>
          </div>
          <h3 className="font-semibold text-sm">
            {item.quantity > 1 && (
              <span className="text-primary mr-1">{item.quantity}×</span>
            )}
            {item.menu_item.name}
          </h3>
          {item.notes && (
            <p className="text-xs text-amber-300/80 mt-0.5 italic">
              note: {item.notes}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <RelativeTime
            date={item.created_at}
            className="text-[10px] text-muted-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            ~{item.menu_item.prep_minutes}m
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar className="h-5 w-5">
            {item.added_by.avatar_url && (
              <AvatarImage src={item.added_by.avatar_url} />
            )}
            <AvatarFallback className="text-[8px]">
              {initials(item.added_by.display_name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-[11px] text-muted-foreground truncate">
            {item.added_by.display_name}
          </span>
        </div>
        <Button
          variant={isNew ? "default" : "gold"}
          size="sm"
          disabled={loading}
          onClick={handleAction}
        >
          {loading
            ? "..."
            : isNew
              ? "Mulai siapkan"
              : "Sudah diantar"}
        </Button>
      </div>
    </Card>
  );
}

// ============================================================
// TAB: ACTIVE TABLES
// ============================================================
function TablesView({ tables }: { tables: ActiveTable[] }) {
  if (tables.length === 0) {
    return (
      <Card className="p-8 text-center border-dashed">
        <Users className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm font-medium">Belum ada meja aktif</p>
        <p className="text-xs text-muted-foreground mt-1">
          Meja yang sudah dibuka customer akan muncul di sini.
        </p>
      </Card>
    );
  }

  const totalRevenue = tables.reduce((sum, t) => sum + t.subtotal, 0);

  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Meja aktif" value={tables.length.toString()} />
        <StatCard
          label="Total tamu"
          value={tables.reduce((sum, t) => sum + t.member_count, 0).toString()}
        />
        <StatCard label="Running bill" value={formatIDR(totalRevenue)} />
      </div>

      {/* Table cards */}
      <div className="grid sm:grid-cols-2 gap-3">
        {tables.map((t) => (
          <Card key={t.session_id} className="p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="text-xs">
                  {t.table_label}
                </Badge>
                <span className="text-xs text-muted-foreground">{t.area_name}</span>
              </div>
              <RelativeTime
                date={t.started_at}
                className="text-[10px] text-muted-foreground"
              />
            </div>

            <h3 className="font-semibold mb-2 truncate">
              {t.title ?? "Open Table"}
            </h3>

            <div className="flex items-center gap-2 mb-3">
              <Avatar className="h-7 w-7">
                {t.host_avatar && <AvatarImage src={t.host_avatar} />}
                <AvatarFallback className="text-[10px]">
                  {initials(t.host_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{t.host_name}</p>
                <p className="text-[10px] text-muted-foreground">Host</p>
              </div>
              <span className="text-xs flex items-center gap-1 text-muted-foreground">
                <Users className="h-3 w-3" />
                {t.member_count}/{t.table_capacity}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Running bill
                </div>
                <div className="text-sm font-semibold text-primary">
                  {formatIDR(t.subtotal)}{" "}
                  <span className="text-[10px] text-muted-foreground font-normal">
                    · {t.item_count} item
                  </span>
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/session/${t.session_id}`}>
                  <Eye className="h-3.5 w-3.5" /> Lihat
                </Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3 text-center">
      <div className="text-lg sm:text-xl font-bold text-gold-gradient truncate">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
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
      onClick={onClick}
      className={cn(
        "relative flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition",
        active
          ? "text-primary border-primary"
          : "text-muted-foreground border-transparent hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          {badge}
        </span>
      )}
      {alert && (
        <span className="absolute top-2 right-2 sm:right-4 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
      )}
    </button>
  );
}
