import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getUserRatingsBatch } from "@/lib/queries";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { UserMenu } from "@/components/UserMenu";
import { RelativeTime } from "@/components/ui/relative-time";
import { PreviewCTA } from "./PreviewCTA";
import {
  ArrowLeft,
  Users,
  Crown,
  Lock,
  Globe,
  UserPlus,
  Sparkles,
  Star,
} from "lucide-react";
import { initials, formatIDR } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPreviewPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select(
      `*,
       tables!inner(label, capacity, shape, min_spend, area_id,
         floor_areas!inner(name, slug, bar_id,
           bars!inner(id, name, slug)
         )
       ),
       host:profiles!table_sessions_host_id_fkey(id, display_name, avatar_url)`
    )
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();

  // Kalau session sudah closed, tidak tampilkan preview — redirect ke landing
  if (session.status === "closed" || session.status === "cancelled") {
    redirect("/");
  }

  const table = Array.isArray(session.tables) ? session.tables[0] : session.tables;
  const area = Array.isArray(table.floor_areas) ? table.floor_areas[0] : table.floor_areas;
  const bar = Array.isArray(area.bars) ? area.bars[0] : area.bars;
  const host = Array.isArray(session.host) ? session.host[0] : session.host;

  // Cek status user saat ini terhadap session
  let myMemberStatus: "joined" | "pending" | "left" | "kicked" | null = null;
  if (profile) {
    const { data: member } = await supabase
      .from("session_members")
      .select("id, status")
      .eq("session_id", id)
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (member?.status === "joined") {
      redirect(`/session/${id}`);
    }
    myMemberStatus = (member?.status as typeof myMemberStatus) ?? null;
  }
  const isHost = profile?.id === session.host_id;

  const { data: members } = await supabase
    .from("session_members")
    .select(
      "id, role, joined_at, profile:profiles!inner(id, display_name, avatar_url, hobbies)"
    )
    .eq("session_id", id)
    .eq("status", "joined")
    .order("joined_at");

  const memberList = (members ?? []).map((m) => {
    const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
    return { id: m.id, role: m.role, joined_at: m.joined_at, profile: p };
  });

  const ratings = await getUserRatingsBatch(memberList.map((m) => m.profile.id));

  // Order summary — agregat per menu item (qty), grouped by category.
  // RLS hanya allow lihat order_items kalau session.visibility = 'public'.
  // Untuk friends/invite_only, ini akan empty array — UI menyembunyikan section.
  const { data: orderItems } = await supabase
    .from("order_items")
    .select(
      `quantity, menu_item:menu_items!inner(name, tags,
         category:menu_categories!inner(name, slug)
       ), order:orders!inner(session_id, status)`
    )
    .eq("order.session_id", id)
    .neq("status", "void");

  // Agregate per category
  const categorySummary = new Map<
    string,
    { name: string; totalQty: number; items: { name: string; qty: number; tags: string[] }[] }
  >();

  for (const oi of orderItems ?? []) {
    const mi = Array.isArray(oi.menu_item) ? oi.menu_item[0] : oi.menu_item;
    const cat = Array.isArray(mi.category) ? mi.category[0] : mi.category;
    const key = cat.slug;
    if (!categorySummary.has(key)) {
      categorySummary.set(key, { name: cat.name, totalQty: 0, items: [] });
    }
    const g = categorySummary.get(key)!;
    g.totalQty += oi.quantity;
    const existing = g.items.find((it) => it.name === mi.name);
    if (existing) {
      existing.qty += oi.quantity;
    } else {
      g.items.push({ name: mi.name, qty: oi.quantity, tags: mi.tags ?? [] });
    }
  }
  const orderSummary = Array.from(categorySummary.values()).sort(
    (a, b) => b.totalQty - a.totalQty
  );

  return (
    <main className="flex-1 pb-12">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/bar/${bar.slug}`} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">
              {area.name} · {bar.name}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              Preview · {table.label}
            </h1>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Hero card */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-start gap-3 mb-3">
              <Avatar className="h-14 w-14 ring-2 ring-primary/30">
                {host.avatar_url && <AvatarImage src={host.avatar_url} />}
                <AvatarFallback className="text-base">
                  {initials(host.display_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-primary mb-0.5">
                  <Crown className="h-3 w-3" />
                  <span>Hosted by</span>
                </div>
                <h2 className="text-xl font-semibold">{host.display_name}</h2>
                <p className="text-sm text-muted-foreground">
                  Buka <RelativeTime date={session.started_at} />
                </p>
              </div>
              <VisibilityBadge visibility={session.visibility} />
            </div>
            {session.title && (
              <p className="text-2xl font-bold text-gold-gradient">{session.title}</p>
            )}
            {session.vibe_tags && session.vibe_tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {session.vibe_tags.map((v: string) => (
                  <Badge key={v} variant="secondary" className="text-xs">
                    {v}
                  </Badge>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/40 border border-border p-3 text-center">
                <Users className="h-4 w-4 mx-auto text-primary mb-1" />
                <div className="text-lg font-semibold">
                  {memberList.length}/{table.capacity}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Members
                </div>
              </div>
              <div className="rounded-md bg-muted/40 border border-border p-3 text-center">
                <Sparkles className="h-4 w-4 mx-auto text-primary mb-1" />
                <div className="text-lg font-semibold capitalize">{table.shape}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {table.label}
                </div>
              </div>
            </div>
            {table.min_spend > 0 && (
              <div className="text-xs text-center text-primary">
                Min spend: {formatIDR(table.min_spend)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Members card */}
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Yang ada di meja
            </h3>
            <div className="space-y-3">
              {memberList.map((m) => {
                const r = ratings[m.profile.id];
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <Avatar>
                      {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
                      <AvatarFallback>{initials(m.profile.display_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-sm truncate">
                          {m.profile.display_name}
                        </p>
                        {m.role === "host" && (
                          <Crown className="h-3 w-3 text-primary" aria-label="Host" />
                        )}
                        {r && r.rating_count > 0 && (
                          <span className="flex items-center gap-0.5 text-[11px] text-primary">
                            <Star className="h-3 w-3 fill-primary" />
                            {r.avg_stars}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Join <RelativeTime date={m.joined_at} />
                      </p>
                      {(m.profile as { hobbies?: string[] }).hobbies && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(m.profile as { hobbies: string[] }).hobbies
                            .slice(0, 4)
                            .map((h) => (
                              <span
                                key={h}
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
                              >
                                {h}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Order summary — hanya muncul kalau session public (RLS) dan ada order */}
        {orderSummary.length > 0 && (
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Yang lagi disajikan
              </h3>
              <div className="space-y-3">
                {orderSummary.map((cat) => (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-primary/80">
                        {cat.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {cat.totalQty} item
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.items.map((it) => (
                        <Badge
                          key={it.name}
                          variant="secondary"
                          className="text-xs"
                        >
                          {it.qty > 1 && (
                            <span className="text-primary/70 mr-1">
                              {it.qty}×
                            </span>
                          )}
                          {it.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3 italic">
                Berikan kamu gambaran vibe-nya. Total tagihan tidak ditampilkan untuk
                preview.
              </p>
            </CardContent>
          </Card>
        )}

        {/* CTA card */}
        <PreviewCTA
          sessionId={id}
          barSlug={bar.slug}
          hostName={host.display_name}
          memberCount={memberList.length}
          capacity={table.capacity}
          isHost={isHost}
          myStatus={myMemberStatus}
          loggedIn={!!profile}
        />
      </div>
    </main>
  );
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === "public") {
    return (
      <Badge variant="secondary" className="text-[10px] gap-1">
        <Globe className="h-3 w-3" /> Public
      </Badge>
    );
  }
  if (visibility === "friends") {
    return (
      <Badge variant="default" className="text-[10px] gap-1">
        <UserPlus className="h-3 w-3" /> Friends
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="text-[10px] gap-1">
      <Lock className="h-3 w-3" /> Invite Only
    </Badge>
  );
}
