import { redirect, notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  sessionInvites,
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { getCurrentUser } from "@/lib/auth-v2/current";
import { JoinForm } from "./JoinForm";

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function JoinByCodePage({ params }: PageProps) {
  const { code } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth?next=${encodeURIComponent(`/join/${code}`)}`);
  }

  // 1. Lookup invite + session + table + area + host (single mega-join)
  const [row] = await db
    .select({
      // invite
      expires_at: sessionInvites.expiresAt,
      max_uses: sessionInvites.maxUses,
      use_count: sessionInvites.useCount,
      // session
      session_id: tableSessions.id,
      session_title: tableSessions.title,
      session_status: tableSessions.status,
      session_vibe_tags: tableSessions.vibeTags,
      // table
      table_label: tables.label,
      table_capacity: tables.capacity,
      table_shape: tables.shape,
      // area
      area_name: floorAreas.name,
      // host
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
    })
    .from(sessionInvites)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionInvites.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(eq(sessionInvites.code, code));

  if (!row) notFound();

  const isExpired = row.expires_at < new Date();
  const isMaxedOut = row.max_uses !== null && row.use_count >= row.max_uses;

  // 2. Member count (joined only)
  const [memberCountRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, row.session_id),
        eq(sessionMembers.status, "joined")
      )
    );

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-8">
      <JoinForm
        code={code}
        invite={{
          isExpired: !!isExpired,
          isMaxedOut: !!isMaxedOut,
        }}
        session={{
          id: row.session_id,
          title: row.session_title,
          status: row.session_status,
          vibe_tags: row.session_vibe_tags ?? [],
        }}
        table={{
          label: row.table_label,
          capacity: row.table_capacity,
          shape: row.table_shape,
          areaName: row.area_name,
        }}
        host={{
          display_name: row.host_name,
          avatar_url: row.host_avatar,
        }}
        memberCount={Number(memberCountRow?.count ?? 0)}
      />
    </main>
  );
}
