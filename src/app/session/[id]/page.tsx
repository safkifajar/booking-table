import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuByBar, getUserRatingsBatch } from "@/lib/queries";
import { SessionView } from "./SessionView";
import { UserMenu } from "@/components/UserMenu";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/session/${id}`)}`);
  }

  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select(
      `*,
       tables!inner(id, label, capacity, shape, area_id,
         floor_areas!inner(name, bar_id,
           bars!inner(id, name, slug)
         )
       ),
       host:profiles!table_sessions_host_id_fkey(id, display_name, avatar_url)`
    )
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();

  const table = Array.isArray(session.tables) ? session.tables[0] : session.tables;
  const area = Array.isArray(table.floor_areas) ? table.floor_areas[0] : table.floor_areas;
  const bar = Array.isArray(area.bars) ? area.bars[0] : area.bars;
  const host = Array.isArray(session.host) ? session.host[0] : session.host;

  // Get members
  const { data: members } = await supabase
    .from("session_members")
    .select(
      "id, role, status, joined_at, profile:profiles!inner(id, display_name, avatar_url, hobbies)"
    )
    .eq("session_id", id)
    .order("joined_at");

  // Get order
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("session_id", id)
    .neq("status", "closed")
    .maybeSingle();

  // Get order items
  const { data: orderItems } = order
    ? await supabase
        .from("order_items")
        .select(
          `*,
           menu_item:menu_items!inner(id, name, image_url),
           member:session_members!inner(id, profile:profiles!inner(id, display_name, avatar_url))`
        )
        .eq("order_id", order.id)
        .neq("status", "void")
        .order("created_at")
    : { data: [] };

  // Get payments
  const { data: payments } = order
    ? await supabase
        .from("payments")
        .select(
          "*, member:session_members!inner(profile:profiles!inner(display_name, avatar_url))"
        )
        .eq("order_id", order.id)
    : { data: [] };

  // Get menu
  const menu = await getMenuByBar(bar.id);

  // Get latest invite code
  const { data: invite } = await supabase
    .from("session_invites")
    .select("code, expires_at")
    .eq("session_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const isHost = session.host_id === profile.id;
  const myMember = members?.find((m) => {
    const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
    return p?.id === profile.id;
  });
  const isMember = !!myMember && myMember.status === "joined";

  // Fetch rating summary for all members (so we can show stars on profile cards)
  const memberProfileIds = (members ?? []).map((m) => {
    const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
    return p.id;
  });
  const ratingsBatch = await getUserRatingsBatch(memberProfileIds);

  return (
    <SessionView
      session={{
        id: session.id,
        title: session.title,
        status: session.status,
        visibility: session.visibility,
        vibe_tags: session.vibe_tags ?? [],
        started_at: session.started_at,
        host_id: session.host_id,
      }}
      table={{
        label: table.label,
        capacity: table.capacity,
        shape: table.shape,
      }}
      areaName={area.name}
      bar={{ name: bar.name, slug: bar.slug }}
      host={{
        id: host.id,
        display_name: host.display_name,
        avatar_url: host.avatar_url,
      }}
      members={(members ?? []).map((m) => {
        const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
        return {
          id: m.id,
          role: m.role,
          status: m.status,
          joined_at: m.joined_at,
          profile: p,
          rating: ratingsBatch[p.id] ?? null,
        };
      })}
      orderItems={(orderItems ?? []).map((oi) => {
        const mi = Array.isArray(oi.menu_item) ? oi.menu_item[0] : oi.menu_item;
        const m = Array.isArray(oi.member) ? oi.member[0] : oi.member;
        const mp = Array.isArray(m.profile) ? m.profile[0] : m.profile;
        return {
          id: oi.id,
          quantity: oi.quantity,
          unit_price: oi.unit_price,
          notes: oi.notes,
          status: oi.status,
          created_at: oi.created_at,
          queue_number: oi.queue_number,
          menu_item: { id: mi.id, name: mi.name, image_url: mi.image_url },
          added_by: {
            member_id: m.id,
            profile_id: mp.id,
            display_name: mp.display_name,
            avatar_url: mp.avatar_url,
          },
        };
      })}
      payments={(payments ?? []).map((p) => {
        const m = Array.isArray(p.member) ? p.member[0] : p.member;
        const mp = Array.isArray(m.profile) ? m.profile[0] : m.profile;
        return {
          id: p.id,
          amount: p.amount,
          method: p.method,
          status: p.status,
          split_mode: p.split_mode,
          paid_at: p.paid_at,
          paid_by: mp.display_name,
          paid_by_avatar: mp.avatar_url,
        };
      })}
      menu={menu}
      myProfileId={profile.id}
      myMemberId={myMember?.id ?? null}
      isHost={isHost}
      isMember={isMember}
      inviteCode={invite?.code ?? null}
      userMenu={<UserMenu />}
    />
  );
}
