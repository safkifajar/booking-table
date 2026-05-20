import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getRatableMembers } from "@/lib/queries";
import { RateForm } from "./RateForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RatePage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/session/${id}/rate`)}`);
  }

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("table_sessions")
    .select(
      "id, title, status, host_id, started_at, closed_at, tables!inner(label)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();

  // Hanya bisa rate kalau session sudah closed
  if (session.status !== "closed") {
    redirect(`/session/${id}`);
  }

  const members = await getRatableMembers(id);

  const table = Array.isArray(session.tables) ? session.tables[0] : session.tables;

  return (
    <RateForm
      sessionId={session.id}
      sessionTitle={session.title}
      tableLabel={table.label}
      members={members}
    />
  );
}
