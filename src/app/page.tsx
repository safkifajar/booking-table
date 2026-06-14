import Link from "next/link";
import { Bell, Search, MapPin, Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoryBarSection } from "@/components/story/StoryBarSection";
import { LiveTablesFeed } from "@/components/feed/LiveTablesFeed";
import { BannerCarousel } from "@/components/feed/BannerCarousel";
import { HomeBottomNav } from "@/components/HomeBottomNav";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getBarBySlug, getActiveSessionsByBar } from "@/lib/queries";
import { getActiveBanners } from "@/lib/banner-actions";

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
  const [activeSessions, banners] = await Promise.all([
    getActiveSessionsByBar(bar.id),
    getActiveBanners(bar.id),
  ]);

  const isAnon = !profile;

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

          {/* Search (placeholder action — future feature) */}
          <button
            type="button"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted/60 transition text-muted-foreground hover:text-foreground"
            aria-label="Cari"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Notification (placeholder action — future feature) */}
          <button
            type="button"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted/60 transition text-muted-foreground hover:text-foreground"
            aria-label="Notifikasi"
          >
            <Bell className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto">
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
              Lihat denah
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <LiveTablesFeed sessions={activeSessions} isAnon={isAnon} />

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

        {/* Bar info footer */}
        <section className="px-4 sm:px-6 pt-6 pb-4 border-t border-border mt-6">
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground">{bar.name}</div>
            {bar.address && (
              <div className="flex items-start gap-1">
                <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{bar.address}</span>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Bottom nav (mobile only) */}
      <HomeBottomNav barId={bar.id} isAnon={isAnon} />
    </main>
  );
}
