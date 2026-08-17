import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { orders, orderItems } from "@/lib/db/schema/orders";
import { menuItems, menuCategories } from "@/lib/db/schema/menu";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getUserRatingsBatch, promoteSessionIfDue } from "@/lib/queries";
import { areFriends, isBlockedEitherWay } from "@/lib/friends";
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
import { initials, formatIDR, cn } from "@/lib/utils";
import {
  getEffectiveRankOf,
  getEffectiveRankMap,
  MEMBERSHIP_RANK,
  tierLabel,
} from "@/lib/membership";
import { getFriendIdSet } from "@/lib/friends";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPreviewPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  // Promote reservasi yg jamnya tiba → 'open' supaya status fresh (request-join
  // butuh status open).
  await promoteSessionIfDue(id);

  // 1. Session + table + area + bar + host (single join)
  const [sessionRow] = await db
    .select({
      id: tableSessions.id,
      title: tableSessions.title,
      status: tableSessions.status,
      visibility: tableSessions.visibility,
      vibe_tags: tableSessions.vibeTags,
      started_at: tableSessions.startedAt,
      host_id: tableSessions.hostId,
      table_label: tables.label,
      table_capacity: tables.capacity,
      table_shape: tables.shape,
      table_min_spend: tables.minSpend,
      area_name: floorAreas.name,
      area_slug: floorAreas.slug,
      bar_id: bars.id,
      bar_name: bars.name,
      bar_slug: bars.slug,
      host_display_name: profiles.displayName,
      host_avatar_url: profiles.avatarUrl,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(eq(tableSessions.id, id));

  if (!sessionRow) notFound();

  // Closed/cancelled → redirect
  if (sessionRow.status === "closed" || sessionRow.status === "cancelled") {
    redirect("/");
  }

  // Convenience refs match shape original (UI binding)
  const session = {
    started_at: sessionRow.started_at.toISOString(),
    visibility: sessionRow.visibility,
    title: sessionRow.title,
    vibe_tags: sessionRow.vibe_tags,
  };
  const table = {
    label: sessionRow.table_label,
    capacity: sessionRow.table_capacity,
    shape: sessionRow.table_shape,
    min_spend: sessionRow.table_min_spend ?? 0,
  };
  const area = { name: sessionRow.area_name, slug: sessionRow.area_slug };
  const bar = { name: sessionRow.bar_name, slug: sessionRow.bar_slug };
  // Gating membership: host ber-tier LEBIH TINGGI dari viewer → foto & nama
  // diburamkan. Halaman ini justru paling relevan — dibuka saat mengintip
  // meja orang yang belum dikenal. Dikecualikan: diri sendiri & teman.
  let hostLocked = false;
  let hostLabel: string | null = null;
  if (profile && profile.id !== sessionRow.host_id) {
    const [viewerRank, rankMap, myFriendIds] = await Promise.all([
      getEffectiveRankOf(profile.id),
      getEffectiveRankMap([sessionRow.host_id]),
      getFriendIdSet(profile.id),
    ]);
    const rank = rankMap.get(sessionRow.host_id) ?? MEMBERSHIP_RANK.basic;
    hostLocked = !myFriendIds.has(sessionRow.host_id) && rank > viewerRank;
    // Nama diganti label tier DI SERVER — nama asli tak dikirim ke browser.
    if (hostLocked) hostLabel = tierLabel(rank);
  }
  const host = {
    display_name: hostLabel ?? sessionRow.host_display_name,
    avatar_url: sessionRow.host_avatar_url,
    locked: hostLocked,
  };

  // 2. Cek status user saat ini
  let myMemberStatus: "joined" | "pending" | "left" | "kicked" | null = null;
  if (profile) {
    const [member] = await db
      .select({ status: sessionMembers.status })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, id),
          eq(sessionMembers.profileId, profile.id)
        )
      );
    if (member?.status === "joined") {
      redirect(`/session/${id}`);
    }
    myMemberStatus = member?.status ?? null;
  }
  const isHost = profile?.id === sessionRow.host_id;

  // Saling blokir dgn host → meja ini seolah tak ada (PRD Friends K6).
  if (profile && !isHost) {
    if (await isBlockedEitherWay(profile.id, sessionRow.host_id)) notFound();
  }
  // Meja "friends": semua boleh LIHAT preview, hanya teman host yg bisa
  // join (PRD K3) — CTA menyesuaikan.
  const isHostFriend =
    profile && !isHost ? await areFriends(profile.id, sessionRow.host_id) : false;

  // 3. Joined members + profile info
  const membersRaw = await db
    .select({
      id: sessionMembers.id,
      role: sessionMembers.role,
      joined_at: sessionMembers.joinedAt,
      profile_id: profiles.id,
      profile_display_name: profiles.displayName,
      profile_avatar_url: profiles.avatarUrl,
      profile_hobbies: profiles.hobbies,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(eq(sessionMembers.sessionId, id), eq(sessionMembers.status, "joined"))
    )
    .orderBy(asc(sessionMembers.joinedAt));

  const memberList = membersRaw.map((m) => ({
    id: m.id,
    role: m.role,
    joined_at: m.joined_at.toISOString(),
    profile: {
      id: m.profile_id,
      display_name: m.profile_display_name,
      avatar_url: m.profile_avatar_url,
      hobbies: m.profile_hobbies,
    },
  }));

  const ratings = await getUserRatingsBatch(memberList.map((m) => m.profile.id));

  // 4. Order items aggregate — semua orders untuk session, items belum void
  // (note: tidak ada RLS lagi; visibility filter di UI saja kalau perlu)
  const orderItemsRaw = await db
    .select({
      quantity: orderItems.quantity,
      menu_item_name: menuItems.name,
      menu_item_tags: menuItems.tags,
      category_name: menuCategories.name,
      category_slug: menuCategories.slug,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(and(eq(orders.sessionId, id), ne(orderItems.status, "void")));

  const categorySummary = new Map<
    string,
    { name: string; totalQty: number; items: { name: string; qty: number; tags: string[] }[] }
  >();
  for (const oi of orderItemsRaw) {
    const key = oi.category_slug;
    if (!categorySummary.has(key)) {
      categorySummary.set(key, { name: oi.category_name, totalQty: 0, items: [] });
    }
    const g = categorySummary.get(key)!;
    g.totalQty += oi.quantity;
    const existing = g.items.find((it) => it.name === oi.menu_item_name);
    if (existing) {
      existing.qty += oi.quantity;
    } else {
      g.items.push({
        name: oi.menu_item_name,
        qty: oi.quantity,
        tags: oi.menu_item_tags ?? [],
      });
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
              {/* Tier host lebih tinggi → foto & nama diburamkan. */}
              <Avatar
                className={cn(
                  "h-14 w-14 ring-2 ring-primary/30",
                  host.locked && "blur-[7px] opacity-80"
                )}
              >
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
                {/* Nama sudah diganti label tier di server → tetap terbaca. */}
                <h2
                  className={cn(
                    "text-xl font-semibold",
                    host.locked && "text-muted-foreground italic"
                  )}
                >
                  {host.display_name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Opened <RelativeTime date={session.started_at} />
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
              Who&apos;s at the table
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
                Gives you a feel for the vibe. Bill total is hidden in
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
          hostId={sessionRow.host_id}
          memberCount={memberList.length}
          capacity={table.capacity}
          isHost={isHost}
          myStatus={myMemberStatus}
          loggedIn={!!profile}
          visibility={session.visibility}
          isHostFriend={isHostFriend}
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
