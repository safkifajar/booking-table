import Link from "next/link";
import { Users } from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { HomeBottomNav } from "@/components/HomeBottomNav";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import {
  getBarBySlug,
  getActiveUsersAtBar,
  getPopularHobbies,
  getMyActiveSessionIds,
} from "@/lib/queries";
import { NetworkView } from "./NetworkView";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const [profile, bar] = await Promise.all([
    getCurrentProfile(),
    getBarBySlug(barSlug),
  ]);

  if (!bar) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <p className="text-sm text-muted-foreground">Bar tidak ditemukan</p>
      </main>
    );
  }

  const [activeUsers, popularHobbies, myActiveSessionIds] = await Promise.all([
    getActiveUsersAtBar(bar.id),
    getPopularHobbies(12),
    profile ? getMyActiveSessionIds(profile.id) : Promise.resolve([]),
  ]);
  const isAnon = !profile;

  return (
    <main className="flex-1 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span
              className="inline-flex h-9 items-center justify-center rounded-lg px-2.5 text-[11px] font-extrabold tracking-tight shadow-md"
              style={{ background: "var(--brand)", color: "var(--brand-cream)" }}
            >
              SO.HO
            </span>
            <span className="text-[10px] uppercase tracking-widest text-primary/70 hidden sm:inline">
              Network
            </span>
          </Link>
          <div className="flex-1" />
          {!isAnon && profile && <NotificationBell userId={profile.id} />}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-4">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Network</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Lihat siapa yang lagi di SOHO & jelajahi member lain buat diajak
          nongkrong.
        </p>

        <NetworkView
          activeUsers={activeUsers}
          myProfileId={profile?.id ?? null}
          myActiveSessionIds={myActiveSessionIds}
          popularHobbies={popularHobbies}
        />
      </div>

      <HomeBottomNav
        barId={bar.id}
        isAnon={isAnon}
        avatarUrl={profile?.avatarUrl ?? null}
        displayName={profile?.displayName ?? null}
      />
    </main>
  );
}
