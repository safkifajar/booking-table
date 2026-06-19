import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, MapPin, ChevronRight } from "lucide-react";
import { RatingStars } from "@/components/network/RatingStars";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { ProfileAvatar } from "@/components/network/ProfileAvatar";
import { TableHistoryList } from "@/components/network/TableHistoryList";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getPublicProfile, getUserTableHistory } from "@/lib/queries";
import { hasActiveStory } from "@/lib/story-actions";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import type { SessionVisibility } from "@/types/db";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ userId: string }>;
}

function visibilityLabel(v: SessionVisibility): string {
  if (v === "public") return "Publik";
  if (v === "friends") return "Teman";
  return "Undangan";
}

export default async function NetworkProfilePage({ params }: PageProps) {
  const { userId } = await params;
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const [me, profile, [bar]] = await Promise.all([
    getCurrentProfile(),
    getPublicProfile(userId),
    db.select({ id: bars.id }).from(bars).where(eq(bars.slug, barSlug)),
  ]);
  if (!profile) notFound();

  const isMe = me?.id === profile.id;
  const active = profile.active_session;

  // Story aktif + riwayat meja (paralel).
  const [hasStory, history] = await Promise.all([
    bar ? hasActiveStory(profile.id, bar.id) : Promise.resolve(false),
    getUserTableHistory(profile.id, 20),
  ]);

  return (
    <main className="flex-1 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/network"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Network
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Identitas */}
        <section className="flex flex-col items-center text-center">
          <ProfileAvatar
            userId={profile.id}
            displayName={profile.display_name}
            avatarUrl={profile.avatar_url}
            hasStory={hasStory}
            barId={bar?.id ?? ""}
            viewerId={me?.id ?? null}
          />
          <h1 className="text-xl font-bold tracking-tight mt-3">
            {profile.display_name}
            {isMe && (
              <span className="ml-2 text-xs font-normal text-muted-foreground align-middle">
                (kamu)
              </span>
            )}
          </h1>
          <div className="mt-1.5">
            <RatingStars rating={profile.rating} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {profile.visit_count > 0
              ? `${profile.visit_count}× nongkrong di SOHO`
              : "Belum pernah nongkrong"}
          </p>
        </section>

        {/* Lagi di meja (kalau ada) */}
        {active && (
          <Link
            href={`/session/${active.session_id}?from=${encodeURIComponent(`/network/${profile.id}`)}`}
            className="block rounded-xl border border-primary/30 bg-primary/5 p-4 transition hover:bg-primary/10"
          >
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              <span className="flex-1">
                Lagi di meja{" "}
                <span className="font-semibold">{active.table_label}</span> ·{" "}
                {visibilityLabel(active.visibility)}
              </span>
              {!isMe && active.visibility === "public" && (
                <span className="shrink-0 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                  Gabung
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-primary/70 shrink-0" />
            </div>
          </Link>
        )}

        {/* Bio */}
        {profile.bio && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-1.5">
              Tentang
            </h2>
            <p className="text-sm whitespace-pre-line">{profile.bio}</p>
          </section>
        )}

        {/* Hobi */}
        {profile.hobbies.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">
              Hobi & minat
            </h2>
            <HobbyBadges hobbies={profile.hobbies} max={20} />
          </section>
        )}

        {/* Rating tags */}
        {profile.rating.top_tags && profile.rating.top_tags.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">
              Kata teman nongkrong
            </h2>
            <HobbyBadges hobbies={profile.rating.top_tags} max={10} />
          </section>
        )}

        {/* Riwayat meja */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            Riwayat nongkrong
          </h2>
          <TableHistoryList entries={history} />
        </section>
      </div>
    </main>
  );
}
