import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
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

  const supabase = await createClient();
  const { data: invite } = await supabase
    .from("session_invites")
    .select(
      `code, expires_at, max_uses, use_count,
       session:table_sessions!inner(
         id, title, status, visibility, vibe_tags,
         table:tables!inner(label, capacity, shape, area:floor_areas!inner(name)),
         host:profiles!table_sessions_host_id_fkey(display_name, avatar_url)
       )`
    )
    .eq("code", code)
    .maybeSingle();

  if (!invite) notFound();

  const isExpired = new Date(invite.expires_at) < new Date();
  const isMaxedOut = invite.max_uses && invite.use_count >= invite.max_uses;

  const session = Array.isArray(invite.session) ? invite.session[0] : invite.session;
  const table = Array.isArray(session.table) ? session.table[0] : session.table;
  const area = Array.isArray(table.area) ? table.area[0] : table.area;
  const host = Array.isArray(session.host) ? session.host[0] : session.host;

  // Member count
  const { count } = await supabase
    .from("session_members")
    .select("*", { count: "exact", head: true })
    .eq("session_id", session.id)
    .eq("status", "joined");

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-8">
      <JoinForm
        code={code}
        invite={{
          isExpired: !!isExpired,
          isMaxedOut: !!isMaxedOut,
        }}
        session={{
          id: session.id,
          title: session.title,
          status: session.status,
          vibe_tags: session.vibe_tags ?? [],
        }}
        table={{
          label: table.label,
          capacity: table.capacity,
          shape: table.shape,
          areaName: area.name,
        }}
        host={{
          display_name: host.display_name,
          avatar_url: host.avatar_url,
        }}
        memberCount={count ?? 0}
      />
    </main>
  );
}
