import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getOutstandingMap } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import { formatIDR } from "@/lib/utils";
import { Crown, Users, Lock, ChevronRight, History, Clock } from "lucide-react";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";

interface SessionRow {
  id: string;
  title: string | null;
  status: "reserved" | "open" | "locked" | "closed" | "cancelled" | "overdue";
  started_at: Date;
  closed_at: Date | null;
  reservation_at: Date | null;
  reservation_end_at: Date | null;
  table_label: string;
  area_name: string;
  bar_name: string;
  is_host: boolean;
  member_status: "pending" | "joined" | "left" | "kicked" | null;
  /** Sisa tagihan belum lunas (0 = lunas / tak ada bill). */
  outstanding: number;
}

export default async function ProfileSessionsPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/sessions");
  }

  // Query: semua session di mana user adalah host ATAU member (status apapun
  // kecuali 'pending' yg tidak pernah jadi joined). Sort terbaru di atas.
  const baseRows = await db
    .select({
      id: tableSessions.id,
      title: tableSessions.title,
      status: tableSessions.status,
      started_at: tableSessions.startedAt,
      closed_at: tableSessions.closedAt,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      table_label: tables.label,
      area_name: floorAreas.name,
      bar_name: bars.name,
      is_host: sql<boolean>`${tableSessions.hostId} = ${profile.id}`.as("is_host"),
      member_status: sessionMembers.status,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .leftJoin(
      sessionMembers,
      and(
        eq(sessionMembers.sessionId, tableSessions.id),
        eq(sessionMembers.profileId, profile.id)
      )
    )
    .where(
      or(
        eq(tableSessions.hostId, profile.id),
        and(
          eq(sessionMembers.profileId, profile.id),
          ne(sessionMembers.status, "pending")
        )
      )
    )
    .orderBy(desc(tableSessions.startedAt))
    .limit(100);

  // Outstanding (sisa tagihan) per sesi → badge "Belum lunas".
  const outMap = await getOutstandingMap(baseRows.map((r) => r.id));
  const rows: SessionRow[] = baseRows.map((r) => ({
    ...r,
    outstanding: outMap.get(r.id) ?? 0,
  }));

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Session History" />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {rows.map((s) => (
              <SessionListItem key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Label waktu pemakaian meja: tanggal + jam. Pakai rentang reservasi kalau ada
 * (booking → "28 Jun 2026 · 13:50–15:50"), selain itu jam mulai pakai
 * (walk-in → "28 Jun 2026 · 20:36").
 */
function usageLabel(session: SessionRow): string {
  const start = session.reservation_at ?? session.started_at;
  const end = session.reservation_end_at;
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
    }).format(d);
  if (!end) return `${tgl(start)} · ${jam(start)}`;
  // Lintas hari → tampilkan tanggal di kedua sisi biar jelas ini menyeberang
  // tengah malam (mis. "10 Jul 21:00 – 11 Jul 03:00").
  if (start.toDateString() !== end.toDateString()) {
    return `${tgl(start)} ${jam(start)} – ${tgl(end)} ${jam(end)}`;
  }
  return `${tgl(start)} · ${jam(start)}–${jam(end)}`;
}

function SessionListItem({ session }: { session: SessionRow }) {
  // Semua session buka detail (/session/[id]) — termasuk cancelled (di detail,
  // tab Menu & Pay disembunyikan karena booking batal, tak ada order/bayar).
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
  status: SessionRow["status"];
  memberStatus: SessionRow["member_status"];
  isHost: boolean;
}) {
  // Sudah keluar / dikeluarkan dari meja → itu info paling relevan untuk DIA,
  // apa pun status mejanya (dulu hanya dicek saat sesi 'closed', jadi meja yang
  // masih berjalan tetap tampil "In progress" walau dia sudah keluar).
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
  // closed — "keluar" sudah ditangani di atas (berlaku utk semua status).
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
