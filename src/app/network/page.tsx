import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { NotificationBell } from "@/components/NotificationBell";
import { UserPlus } from "lucide-react";
import { getIncomingRequestCount } from "@/lib/friend-actions";
import { HomeBottomNav } from "@/components/HomeBottomNav";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getBarBySlug } from "@/lib/queries";
import { getHobbyGroups } from "@/lib/hobby-actions";
import { SohoGlow } from "@/components/ui/soho-glow";
import { NetworkView } from "./NetworkView";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const [profile, bar] = await Promise.all([
    getCurrentProfile(),
    getBarBySlug(barSlug),
  ]);

  // Network khusus user login → anon diarahkan ke login/daftar.
  if (!profile) {
    redirect("/auth?next=/network");
  }
  // Belum selesai daftar → paksa onboarding.
  if (!profile.onboarded) {
    redirect("/onboarding");
  }

  if (!bar) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <p className="text-sm text-muted-foreground">Bar not found</p>
      </main>
    );
  }

  const interestCatalog = await getHobbyGroups();
  const isAnon = !profile;

  const requestCount = !isAnon && profile ? await getIncomingRequestCount() : 0;

  return (
    <main className="relative flex-1 pb-24">
      <SohoGlow />
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="inline-flex h-9 w-9 rounded-lg overflow-hidden border border-border shadow-md shrink-0">
              <Image
                src="/logo-soho.jpeg"
                alt="SOHO"
                width={36}
                height={36}
                className="h-full w-full object-cover"
              />
            </span>
            <span className="text-sm font-semibold">Network</span>
          </Link>
          <div className="flex-1" />
          {/* Friend requests masuk — badge jumlah (PRD Friends j). */}
          {!isAnon && profile && requestCount > 0 && (
            <Link
              href="/profile/friends?tab=requests"
              aria-label={`${requestCount} friend requests`}
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
            >
              <UserPlus className="h-5 w-5" />
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                {requestCount > 9 ? "9+" : requestCount}
              </span>
            </Link>
          )}
          {!isAnon && profile && <NotificationBell userId={profile.id} />}
        </div>
      </header>

      <NetworkView
        myProfileId={profile?.id ?? null}
        interestCatalog={interestCatalog}
        interestedIn={
          (profile?.interestedIn as "male" | "female" | "both" | "") ?? ""
        }
      />

      <HomeBottomNav
        barId={bar.id}
        isAnon={isAnon}
        avatarUrl={profile?.avatarUrl ?? null}
        displayName={profile?.displayName ?? null}
      />
    </main>
  );
}
