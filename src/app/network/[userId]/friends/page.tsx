import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getPublicProfile } from "@/lib/queries";
import {
  areFriends,
  isBlockedEitherWay,
  getBlockedIdSet,
  getFriendsListOf,
  getFriendIdSet,
} from "@/lib/friends";
import {
  getEffectiveRankMap,
  getEffectiveRankOf,
  MEMBERSHIP_RANK,
} from "@/lib/membership";
import { initials } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ userId: string }>;
}

/**
 * Daftar teman milik USER LAIN (PRD Friends req. f).
 *
 * Aturan:
 * - saling blokir dgn pemilik → 404 (sama seperti halaman profilnya);
 * - akun privat → daftar teman hanya terbuka untuk TEMAN-nya (K5: teman
 *   membuka akun privat) & pemiliknya sendiri;
 * - orang yang saling blokir dgn VIEWER disaring dari daftar — jangan sampai
 *   bocor lewat daftar teman orang lain (PRD 7.2).
 */
export default async function UserFriendsPage({ params }: PageProps) {
  const { userId } = await params;
  const me = await getCurrentProfile();
  const profile = await getPublicProfile(userId, { viewerId: me?.id ?? null });
  if (!profile) notFound();

  const isMe = me?.id === profile.id;
  if (me && !isMe && (await isBlockedEitherWay(me.id, profile.id))) notFound();

  const isFriend =
    me && !isMe ? await areFriends(me.id, profile.id) : false;
  // profile.is_private sudah memperhitungkan bypass teman/pemilik di
  // getPublicProfile — kalau masih true, viewer memang tak berhak melihat.
  const locked = profile.is_private && !isMe && !isFriend;

  const friends = locked
    ? []
    : await getFriendsListOf(profile.id, {
        excludeIds: me ? await getBlockedIdSet(me.id) : undefined,
      });

  // Kunci LEVEL per-baris (PRD Membership M4): teman si pemilik yang level-nya
  // > level viewer (dan bukan teman viewer) tampil TERKUNCI — nama terlihat,
  // tak bisa diklik. Viewer anonim = basic.
  const rowLockedIds = new Set<string>();
  if (friends.length > 0) {
    const [viewerRank, rankMap, myFriendIds] = await Promise.all([
      me ? getEffectiveRankOf(me.id) : Promise.resolve(MEMBERSHIP_RANK.basic),
      getEffectiveRankMap(friends.map((f) => f.id)),
      me ? getFriendIdSet(me.id) : Promise.resolve(new Set<string>()),
    ]);
    for (const f of friends) {
      const isSelf = me?.id === f.id;
      const r = rankMap.get(f.id) ?? MEMBERSHIP_RANK.basic;
      if (!isSelf && !myFriendIds.has(f.id) && r > viewerRank) {
        rowLockedIds.add(f.id);
      }
    }
  }

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/network/${profile.id}`} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground truncate">
              {profile.display_name}
            </div>
            <h1 className="text-base sm:text-lg font-semibold">Friends</h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {locked ? (
          <Card className="p-8 text-center border-dashed">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">This account is private</p>
            <p className="text-xs text-muted-foreground mt-1">
              Only {profile.display_name}&apos;s friends can see who they are
              friends with.
            </p>
          </Card>
        ) : friends.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <Users className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {isMe
                ? "You have no friends yet."
                : `${profile.display_name} has no friends yet.`}
            </p>
          </Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {friends.length} friend{friends.length === 1 ? "" : "s"}
            </p>
            <Card className="divide-y divide-border">
              {friends.map((f) => {
                const rowLocked = rowLockedIds.has(f.id);
                const inner = (
                  <>
                    <Avatar className="h-10 w-10 shrink-0">
                      {f.avatar_url && <AvatarImage src={f.avatar_url} />}
                      <AvatarFallback className="text-xs">
                        {initials(f.display_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium truncate",
                          !rowLocked && "group-hover:text-primary transition"
                        )}
                      >
                        {f.display_name}
                      </p>
                      {rowLocked ? (
                        <p className="text-xs text-muted-foreground">
                          Higher membership tier
                        </p>
                      ) : (
                        f.username && (
                          <p className="text-xs text-muted-foreground truncate">
                            @{f.username}
                          </p>
                        )
                      )}
                    </div>
                    {rowLocked && (
                      <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                  </>
                );
                // Terkunci level → bukan link (profilnya toh stub terkunci).
                return rowLocked ? (
                  <div key={f.id} className="flex items-center gap-3 p-3 opacity-70">
                    {inner}
                  </div>
                ) : (
                  <Link
                    key={f.id}
                    href={`/network/${f.id}`}
                    className="flex items-center gap-3 p-3 hover:bg-muted/40 transition group"
                  >
                    {inner}
                  </Link>
                );
              })}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
