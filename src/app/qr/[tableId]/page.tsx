import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

interface PageProps {
  params: Promise<{ tableId: string }>;
}

/**
 * QR scan endpoint. URL: /qr/[tableId]
 *
 * Routing logic:
 * - Table not found → 404
 * - User not logged in → /auth?next=/qr/[tableId] (loop back here after auth)
 * - Table has active session:
 *     - User is already a joined member → /session/[id]
 *     - User is staff → /session/[id] (read-only via RLS, can see bill)
 *     - Otherwise → /session/[id]/preview (request join flow)
 * - Table available (no session) → /open-table?tableId=...
 */
export default async function QrScanPage({ params }: PageProps) {
  const { tableId } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/qr/${tableId}`)}`);
  }

  const supabase = await createClient();

  // Validate table exists & is active
  const { data: table } = await supabase
    .from("tables")
    .select("id, is_active, floor_areas!inner(bar_id)")
    .eq("id", tableId)
    .maybeSingle();
  if (!table || !table.is_active) notFound();

  // Cek apakah ada session aktif di meja ini
  const { data: session } = await supabase
    .from("table_sessions")
    .select("id, host_id, visibility")
    .eq("table_id", tableId)
    .in("status", ["open", "locked"])
    .maybeSingle();

  if (!session) {
    // Meja kosong → buka meja
    redirect(`/open-table?tableId=${tableId}`);
  }

  // Cek apakah user adalah member meja itu
  const { data: member } = await supabase
    .from("session_members")
    .select("id, status")
    .eq("session_id", session.id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (member?.status === "joined" || session.host_id === profile.id) {
    redirect(`/session/${session.id}`);
  }

  // Cek apakah staff (RLS allow akses penuh ke session)
  const area = Array.isArray(table.floor_areas)
    ? table.floor_areas[0]
    : table.floor_areas;
  const { data: staff } = await supabase
    .from("staff_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("bar_id", area.bar_id)
    .eq("is_active", true)
    .maybeSingle();

  if (staff) {
    redirect(`/session/${session.id}`);
  }

  // Default: preview page → bisa request join
  redirect(`/session/${session.id}/preview`);
}
