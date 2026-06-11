import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions } from "@/lib/db/schema/sessions";
import { tables } from "@/lib/db/schema/venue";
import { getCurrentProfile } from "@/lib/auth-v2/current";
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

  // Session + table info
  const [row] = await db
    .select({
      id: tableSessions.id,
      title: tableSessions.title,
      status: tableSessions.status,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, id));

  if (!row) notFound();

  // Hanya bisa rate kalau session sudah closed
  if (row.status !== "closed") {
    redirect(`/session/${id}`);
  }

  const members = await getRatableMembers(id, profile.id);

  return (
    <RateForm
      sessionId={row.id}
      sessionTitle={row.title}
      tableLabel={row.table_label}
      members={members}
    />
  );
}
