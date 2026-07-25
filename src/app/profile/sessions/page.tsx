import { redirect } from "next/navigation";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getOutstandingMap } from "@/lib/queries";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import {
  SessionsHistoryView,
  type SessionHistoryRow,
} from "./SessionsHistoryView";

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

  // Outstanding (sisa tagihan) per sesi → badge "Unpaid".
  const outMap = await getOutstandingMap(baseRows.map((r) => r.id));
  // Serialize Date → ISO untuk client component (filter interaktif).
  const rows: SessionHistoryRow[] = baseRows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    started_at: r.started_at.toISOString(),
    reservation_at: r.reservation_at ? r.reservation_at.toISOString() : null,
    reservation_end_at: r.reservation_end_at
      ? r.reservation_end_at.toISOString()
      : null,
    table_label: r.table_label,
    area_name: r.area_name,
    bar_name: r.bar_name,
    is_host: r.is_host,
    member_status: r.member_status,
    outstanding: outMap.get(r.id) ?? 0,
  }));

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Session History" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <SessionsHistoryView rows={rows} />
      </div>
    </main>
  );
}
