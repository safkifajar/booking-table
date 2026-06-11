import { redirect, notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { staffRoles } from "@/lib/db/schema/extras";
import { getCurrentProfile } from "@/lib/auth-v2/current";

interface PageProps {
  params: Promise<{ tableId: string }>;
}

/**
 * QR scan endpoint. URL: /qr/[tableId]
 *
 * Routing logic:
 * - Table not found / inactive → 404
 * - User not logged in → /auth?next=/qr/[tableId]
 * - Table has active session:
 *     - User is host or joined member → /session/[id]
 *     - User is staff di bar tersebut → /session/[id]
 *     - Otherwise → /session/[id]/preview (request join flow)
 * - Table available (no session) → /open-table?tableId=...
 */
export default async function QrScanPage({ params }: PageProps) {
  const { tableId } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/qr/${tableId}`)}`);
  }

  // 1. Validate table exists & active + get bar_id
  const [table] = await db
    .select({
      id: tables.id,
      is_active: tables.isActive,
      bar_id: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, tableId));

  if (!table || !table.is_active) notFound();

  // 2. Active session di meja ini?
  const [session] = await db
    .select({
      id: tableSessions.id,
      host_id: tableSessions.hostId,
      visibility: tableSessions.visibility,
    })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tableId, tableId),
        inArray(tableSessions.status, ["open", "locked"])
      )
    );

  if (!session) {
    redirect(`/open-table?tableId=${tableId}`);
  }

  // 3. User is host?
  if (session.host_id === profile.id) {
    redirect(`/session/${session.id}`);
  }

  // 4. User is joined member?
  const [member] = await db
    .select({ status: sessionMembers.status })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, session.id),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  if (member?.status === "joined") {
    redirect(`/session/${session.id}`);
  }

  // 5. User is staff di bar ini?
  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profile.id),
        eq(staffRoles.barId, table.bar_id),
        eq(staffRoles.isActive, true)
      )
    );

  if (staff) {
    redirect(`/session/${session.id}`);
  }

  // 6. Default: preview page → bisa request join
  redirect(`/session/${session.id}/preview`);
}
