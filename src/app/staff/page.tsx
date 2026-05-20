import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { UserMenu } from "@/components/UserMenu";
import { StaffDashboard } from "./StaffDashboard";
import { ChefHat, Lock, QrCode } from "lucide-react";
import { initials, formatIDR } from "@/lib/utils";

export default async function StaffPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/staff");
  }

  const supabase = await createClient();

  // Cek staff role
  const { data: staff } = await supabase
    .from("staff_roles")
    .select("role, bar_id, bars!inner(id, name, slug)")
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!staff) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="max-w-md text-center p-8">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-2">Akses Staff Diperlukan</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Halaman ini hanya untuk staff bar. Hubungi manager kalau kamu butuh akses.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Kembali ke beranda</Link>
          </Button>
        </Card>
      </main>
    );
  }

  const bar = Array.isArray(staff.bars) ? staff.bars[0] : staff.bars;

  // Fetch order queue: items dengan status sent atau preparing
  const { data: queueItems } = await supabase
    .from("order_items")
    .select(
      `id, quantity, notes, status, created_at, queue_number,
       menu_item:menu_items!inner(name, prep_minutes),
       added_by:session_members!inner(
         profile:profiles!inner(display_name, avatar_url)
       ),
       order:orders!inner(
         session:table_sessions!inner(
           id, status, title,
           table:tables!inner(label,
             area:floor_areas!inner(name, bar_id)
           )
         )
       )`
    )
    .in("status", ["sent", "preparing"])
    .order("queue_number", { ascending: true });

  // Filter by bar
  const filteredQueue = (queueItems ?? []).filter((qi) => {
    const order = Array.isArray(qi.order) ? qi.order[0] : qi.order;
    const session = Array.isArray(order.session) ? order.session[0] : order.session;
    const table = Array.isArray(session.table) ? session.table[0] : session.table;
    const area = Array.isArray(table.area) ? table.area[0] : table.area;
    return area.bar_id === bar.id && session.status === "open";
  });

  // Fetch active sessions
  const { data: activeSessions } = await supabase
    .from("v_active_sessions")
    .select("*")
    .order("started_at", { ascending: false });

  // Filter by bar (lewat join meja-area-bar)
  const { data: tablesInBar } = await supabase
    .from("tables")
    .select("id, floor_areas!inner(bar_id)")
    .eq("floor_areas.bar_id", bar.id);

  const barTableIds = new Set((tablesInBar ?? []).map((t) => t.id));
  const filteredSessions = (activeSessions ?? []).filter((s) =>
    barTableIds.has(s.table_id)
  );

  // Get bill per session
  const sessionIds = filteredSessions.map((s) => s.id);
  const { data: bills } = sessionIds.length
    ? await supabase
        .from("v_session_bill")
        .select("*")
        .in("session_id", sessionIds)
    : { data: [] };

  const billMap = new Map((bills ?? []).map((b) => [b.session_id, b]));

  // Normalize queue items for client
  const queue = filteredQueue.map((qi) => {
    const order = Array.isArray(qi.order) ? qi.order[0] : qi.order;
    const session = Array.isArray(order.session) ? order.session[0] : order.session;
    const table = Array.isArray(session.table) ? session.table[0] : session.table;
    const area = Array.isArray(table.area) ? table.area[0] : table.area;
    const mi = Array.isArray(qi.menu_item) ? qi.menu_item[0] : qi.menu_item;
    const addedBy = Array.isArray(qi.added_by) ? qi.added_by[0] : qi.added_by;
    const addedByProfile = Array.isArray(addedBy.profile)
      ? addedBy.profile[0]
      : addedBy.profile;
    return {
      id: qi.id,
      quantity: qi.quantity,
      notes: qi.notes,
      status: qi.status as "sent" | "preparing",
      created_at: qi.created_at,
      queue_number: qi.queue_number,
      menu_item: { name: mi.name, prep_minutes: mi.prep_minutes },
      added_by: {
        display_name: addedByProfile.display_name,
        avatar_url: addedByProfile.avatar_url,
      },
      table: { label: table.label, area_name: area.name },
      session_id: session.id,
      session_title: session.title,
    };
  });

  const tables = filteredSessions.map((s) => ({
    session_id: s.id,
    table_label: s.table_label,
    area_name: s.area_name,
    title: s.title,
    host_name: s.host_name,
    host_avatar: s.host_avatar,
    member_count: s.member_count,
    table_capacity: s.table_capacity,
    started_at: s.started_at,
    subtotal: billMap.get(s.id)?.subtotal ?? 0,
    item_count: billMap.get(s.id)?.item_count ?? 0,
  }));

  return (
    <main className="flex-1 pb-12">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <ChefHat className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-primary/70">
              Staff Dashboard · {staff.role}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">{bar.name}</h1>
          </div>
          <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
            <Link href="/staff/qr">
              <QrCode className="h-4 w-4" /> QR Codes
            </Link>
          </Button>
          <UserMenu />
        </div>
      </header>

      <StaffDashboard initialQueue={queue} initialTables={tables} barId={bar.id} />
    </main>
  );
}
