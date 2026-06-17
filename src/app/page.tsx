import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { PushSetup, PushBanner } from "@/components/PushSetup";
import { StoryBarSection } from "@/components/story/StoryBarSection";
import { LiveTablesFeed } from "@/components/feed/LiveTablesFeed";
import { BannerCarousel } from "@/components/feed/BannerCarousel";
import { HomeBottomNav } from "@/components/HomeBottomNav";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import {
  getBarBySlug,
  getActiveSessionsByBar,
  getUnpaidSessionsForProfile,
} from "@/lib/queries";
import { getActiveBanners } from "@/lib/banner-actions";
import { UnpaidBanner } from "@/components/UnpaidBanner";

/** Sapaan kontekstual berdasar jam (WIB / waktu server). */
function greeting(hour: number): string {
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 18) return "Selamat sore";
  return "Selamat malam";
}

export default async function HomePage() {
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

  // Fetch data feed (parallel)
  const [activeSessions, banners, unpaidSessions] = await Promise.all([
    getActiveSessionsByBar(bar.id),
    getActiveBanners(bar.id),
    profile ? getUnpaidSessionsForProfile(profile.id) : Promise.resolve([]),
  ]);

  const isAnon = !profile;
  // Sapaan (Server Component — aman akses Date di server). WIB.
  const firstName = profile?.displayName?.trim().split(/\s+/)[0] ?? null;
  const greet = greeting(new Date().getHours());

  return (
    <main className="flex-1 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1 shrink-0">
            <span className="text-base font-bold tracking-tight">SOHO</span>
            <span className="text-[10px] uppercase tracking-widest text-primary/70 hidden sm:inline">
              Social House
            </span>
          </Link>

          <div className="flex-1" />

          {/* Notifikasi: tombol aktifkan push + bell (hanya user login) */}
          {!isAnon && profile && (
            <>
              <PushSetup />
              <NotificationBell userId={profile.id} />
            </>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto">
        {/* Sapaan kontekstual (user login) */}
        {!isAnon && firstName && (
          <div className="px-4 sm:px-6 pt-4">
            <p className="text-xs text-muted-foreground">{greet},</p>
            <h1 className="text-xl font-bold tracking-tight">
              {firstName} <span className="font-normal">👋</span>
            </h1>
          </div>
        )}

        {/* Soft-banner aktifkan notifikasi (user login) — proaktif tanpa
            auto-prompt. Klik Aktifkan baru minta izin browser. */}
        {!isAnon && profile && <PushBanner />}

        {/* Banner tagihan belum lunas (user login) — overdue / closed-belum-lunas */}
        {!isAnon && profile && <UnpaidBanner sessions={unpaidSessions} />}

        {/* Story bar — logged-in only (Server Component skip render kalau anon) */}
        <StoryBarSection barSlug={barSlug} />

        {/* Anon CTA banner */}
        {isAnon && (
          <div className="mx-4 sm:mx-6 my-4 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Gabung untuk lihat lebih</div>
              <div className="text-xs text-muted-foreground">
                Sign in untuk join meja, share story, dan kenalan dengan vibe SOHO.
              </div>
            </div>
            <Button asChild size="sm" variant="gold">
              <Link href="/auth?next=/">Masuk</Link>
            </Button>
          </div>
        )}

        {/* LIVE NOW */}
        <section className="px-4 sm:px-6 pt-4 pb-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-xs uppercase tracking-widest font-semibold text-foreground/80">
                Live now
              </h2>
              {activeSessions.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  · {activeSessions.length} meja
                </span>
              )}
            </div>
            <Link
              href={`/bar/${barSlug}`}
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              Lihat semua
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <LiveTablesFeed
            sessions={activeSessions.slice(0, 5)}
            isAnon={isAnon}
          />

          {/* Lihat semua kalau ada lebih dari 5 meja live */}
          {activeSessions.length > 5 && (
            <Link
              href={`/bar/${barSlug}`}
              className="mt-3 flex items-center justify-center gap-1 rounded-lg border border-border py-2.5 text-sm font-medium text-primary hover:bg-primary/[0.06] transition"
            >
              Lihat semua ({activeSessions.length} meja)
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}

          {/* CTA: buka meja sendiri */}
          {!isAnon && (
            <div className="mt-4">
              <Button asChild variant="outline" className="w-full" size="default">
                <Link href={`/bar/${barSlug}`}>
                  <Plus className="h-3.5 w-3.5" />
                  <span className="text-xs">Buka meja sendiri</span>
                </Link>
              </Button>
            </div>
          )}
        </section>

        {/* Promo banner carousel */}
        {banners.length > 0 && (
          <section className="px-4 sm:px-6 pt-6">
            <h2 className="text-xs uppercase tracking-widest font-semibold text-foreground/80 mb-3">
              Promo & Event
            </h2>
            <BannerCarousel banners={banners} />
          </section>
        )}

      </div>

      {/* Bottom nav (mobile only) */}
      <HomeBottomNav
        barId={bar.id}
        isAnon={isAnon}
        avatarUrl={profile?.avatarUrl ?? null}
        displayName={profile?.displayName ?? null}
      />
    </main>
  );
}
