import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { Crown, Users, Lock, ChevronRight, History } from "lucide-react";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";

interface SessionRow {
  id: string;
  title: string | null;
  status: "open" | "locked" | "closed" | "cancelled";
  started_at: Date;
  closed_at: Date | null;
  table_label: string;
  area_name: string;
  bar_name: string;
  is_host: boolean;
  member_status: "pending" | "joined" | "left" | "kicked" | null;
}

export default async function ProfileSessionsPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/sessions");
  }

  // Query: semua session di mana user adalah host ATAU member (status apapun
  // kecuali 'pending' yg tidak pernah jadi joined). Sort terbaru di atas.
  const rows: SessionRow[] = await db
    .select({
      id: tableSessions.id,
      title: tableSessions.title,
      status: tableSessions.status,
      started_at: tableSessions.startedAt,
      closed_at: tableSessions.closedAt,
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

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Riwayat Session" eyebrow="Profile" />

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

function SessionListItem({ session }: { session: SessionRow }) {
  const isActive = session.status === "open" || session.status === "locked";
  // Untuk session aktif → /session/[id]. Untuk closed/cancelled → /session/[id]/rate
  // (rate page handle empty state untuk solo sessions, jadi aman).
  const href = isActive ? `/session/${session.id}` : `/session/${session.id}/rate`;

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
              aria-label="Kamu host"
            >
              <Crown className="h-3 w-3" />
              Host
            </span>
          )}
        </div>
        <div className="text-sm font-medium truncate">
          {session.title ?? "Open Table"}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          <RelativeTime
            date={session.started_at.toISOString()}
            className="text-[11px]"
          />
          <span>·</span>
          <StatusBadge
            status={session.status}
            memberStatus={session.member_status}
            isHost={session.is_host}
          />
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
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <Users className="h-3 w-3" /> Sedang berlangsung
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
  if (status === "cancelled") {
    return <span className="text-muted-foreground">Dibatalkan</span>;
  }
  // closed
  if (!isHost && memberStatus === "kicked") {
    return <span className="text-red-400/80">Dikeluarkan</span>;
  }
  if (!isHost && memberStatus === "left") {
    return <span className="text-muted-foreground">Keluar lebih awal</span>;
  }
  return <span className="text-muted-foreground">Selesai</span>;
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <History className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
      <h2 className="text-sm font-medium mb-1">Belum ada riwayat</h2>
      <p className="text-xs text-muted-foreground">
        Setelah kamu buka atau gabung meja, riwayat session akan tampil di sini.
      </p>
    </div>
  );
}
