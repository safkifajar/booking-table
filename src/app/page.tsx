import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { PushBanner } from "@/components/PushSetup";
import { StoryBarSection } from "@/components/story/StoryBarSection";
import { LiveTablesFeed } from "@/components/feed/LiveTablesFeed";
import { BannerCarousel } from "@/components/feed/BannerCarousel";
import { HomeBottomNav } from "@/components/HomeBottomNav";
import { SohoGlow } from "@/components/ui/soho-glow";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import {
  getBarBySlug,
  getActiveSessionsByBar,
  getUnpaidSessionsForProfile,
  getPendingCashierBookingsForProfile,
  expireFinishedSessions,
  expireOverduePayAtCashierOrders,
  promoteDueReservations,
  getJoinedSessionIds,
} from "@/lib/queries";
import { getActiveBanners } from "@/lib/banner-actions";
import { UnpaidBanner } from "@/components/UnpaidBanner";
import { PendingCashierBanner } from "@/components/PendingCashierBanner";
import { MembershipBanner } from "@/components/MembershipBanner";

// Selalu dinamis: expireFinishedSessions/promoteDueReservations jalan tiap
// kunjungan (sesi lewat-waktu tak menggantung di denah/riwayat).
export const dynamic = "force-dynamic";

/** Sapaan kontekstual berdasar jam (WIB / waktu server). */
function greeting(hour: number): string {
  if (hour < 11) return "Good morning";
  if (hour < 15) return "Good afternoon";
  if (hour < 18) return "Good evening";
  return "Good night";
}

export default async function HomePage() {
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const [profile, bar] = await Promise.all([
    getCurrentProfile(),
    getBarBySlug(barSlug),
  ]);

  // Gate onboarding: user login yg belum selesai daftar → paksa ke wizard.
  if (profile && !profile.onboarded) {
    redirect("/onboarding");
  }

  if (!bar) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <p className="text-sm text-muted-foreground">Bar not found</p>
      </main>
    );
  }

  // Lazy cleanup sebelum baca sesi aktif (sama pola dgn /bar/[slug] & dashboard
  // staff): tutup sesi yg selesai (reservasi lewat / walk-in basi >12 jam) lalu
  // promote reservasi yg waktunya tiba. Tanpa ini, sesi lama yg lupa ditutup
  // tetap muncul di "LIVE NOW" walau sudah berhari-hari.
  await expireFinishedSessions(bar.id);
  await promoteDueReservations(bar.id);
  // Order pay-at-cashier yang lewat 10 mnt → batalkan (meja tetap open) supaya
  // banner "segera ke kasir" & tagihan tak menggantung.
  await expireOverduePayAtCashierOrders(bar.id).catch(() => {});

  // Fetch data feed (parallel)
  const [allSessions, banners, unpaidSessions, pendingCashierBookings] =
    await Promise.all([
      getActiveSessionsByBar(bar.id),
      getActiveBanners(bar.id),
      profile ? getUnpaidSessionsForProfile(profile.id) : Promise.resolve([]),
      profile
        ? getPendingCashierBookingsForProfile(profile.id)
        : Promise.resolve([]),
    ]);

  // "LIVE NOW" = meja yg BENAR-BENAR sedang dipakai sekarang → hanya open/locked.
  // Exclude 'reserved' (booking belum mulai) & 'overdue' (booking lewat-waktu yg
  // belum lunas — bisa sudah pulang, bukan okupansi fisik; ditangani via banner
  // tagihan, bukan feed live).
  const activeSessions = allSessions.filter(
    (s) => s.status === "open" || s.status === "locked"
  );

  // Meja mana yang DIIKUTI user ini → dipakai badge "You're in" di kartu.
  const joinedIds = profile
    ? await getJoinedSessionIds(
        profile.id,
        activeSessions.map((s) => s.id)
      )
    : new Set<string>();

  const isAnon = !profile;
  // Sapaan (Server Component — aman akses Date di server). WIB.
  const firstName = profile?.displayName?.trim().split(/\s+/)[0] ?? null;
  const greet = greeting(new Date().getHours());

  return (
    <main className="relative flex-1 pb-24">
      <SohoGlow />
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 rounded-lg overflow-hidden border border-border shadow-md shrink-0">
              <Image
                src="/logo-soho.jpeg"
                alt="SOHO"
                width={36}
                height={36}
                className="h-full w-full object-cover"
              />
            </span>
            {!isAnon && firstName ? (
              <span className="min-w-0">
                <span className="block text-[10px] text-muted-foreground leading-tight">
                  {greet},
                </span>
                <span className="block text-sm font-bold tracking-tight truncate leading-tight">
                  {firstName} 👋
                </span>
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-widest text-primary/70 hidden sm:inline">
                Social House
              </span>
            )}
          </Link>

          <div className="flex-1" />

          {/* Bell notifikasi (hanya user login). Tombol "aktifkan push" TIDAK
              di header — cukup lewat banner "Enable notifications" di bawah,
              supaya header tak punya dua ikon lonceng. */}
          {!isAnon && profile && <NotificationBell userId={profile.id} />}
        </div>
      </header>

      <div className="max-w-2xl mx-auto">
        {/* Sapaan (greeting + nama) sudah pindah ke header, di samping logo. */}

        {/* Soft-banner aktifkan notifikasi (user login) — proaktif tanpa
            auto-prompt. Klik Aktifkan baru minta izin browser. */}
        {!isAnon && profile && <PushBanner />}

        {/* Banner "segera ke kasir" — booking DP menunggu bayar di kasir +
            countdown. Paling atas di antara banner: paling mendesak (batas 10 mnt). */}
        {!isAnon && profile && (
          <PendingCashierBanner bookings={pendingCashierBookings} />
        )}

        {/* Banner tagihan belum lunas (user login) — overdue / closed-belum-lunas */}
        {!isAnon && profile && <UnpaidBanner sessions={unpaidSessions} />}

        {/* Banner membership (PRD Membership M11): basic → upgrade;
            H-7 kedaluwarsa → perpanjang. Render null saat tak perlu → tanpa
            wrapper margin supaya tak menyisakan gap kosong. */}
        {!isAnon && profile && <MembershipBanner profileId={profile.id} />}

        {/* Story bar — logged-in only (Server Component skip render kalau anon) */}
        <StoryBarSection barSlug={barSlug} />

        {/* Anon CTA banner */}
        {isAnon && (
          <div className="mx-4 sm:mx-6 my-4 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Join to see more</div>
              <div className="text-xs text-muted-foreground">
                Sign in to join tables, share stories, and get to know the SOHO vibe.
              </div>
            </div>
            <Button asChild size="sm" variant="gold">
              <Link href="/auth?next=/">Sign in</Link>
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
                  · {activeSessions.length} tables
                </span>
              )}
            </div>
            <Link
              href={`/bar/${barSlug}`}
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              See all
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <LiveTablesFeed
            sessions={activeSessions.slice(0, 5)}
            isAnon={isAnon}
            joinedIds={Array.from(joinedIds)}
            viewerId={profile?.id ?? null}
          />

          {/* Lihat semua kalau ada lebih dari 5 meja live */}
          {activeSessions.length > 5 && (
            <Link
              href={`/bar/${barSlug}`}
              className="mt-3 flex items-center justify-center gap-1 rounded-lg border border-border py-2.5 text-sm font-medium text-primary hover:bg-primary/[0.06] transition"
            >
              See all ({activeSessions.length} tables)
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}

          {/* CTA: buka meja sendiri — tombol glowing merah (CTA utama) */}
          {!isAnon && (
            <div className="mt-4">
              <Link
                href={`/bar/${barSlug}`}
                className="group relative flex w-full items-center justify-center gap-2 rounded-xl border border-primary/60 bg-gradient-to-b from-primary/[0.12] to-primary/[0.04] py-3.5 text-sm font-semibold text-foreground shadow-[0_0_20px_-4px_rgba(225,29,42,0.5)] transition hover:border-primary hover:from-primary/20 hover:shadow-[0_0_28px_-2px_rgba(225,29,42,0.7)]"
              >
                <Plus className="h-4 w-4 text-primary transition group-hover:scale-110" />
                <span>Open your own table</span>
              </Link>
            </div>
          )}
        </section>

        {/* Promo banner carousel */}
        {banners.length > 0 && (
          <section className="px-4 sm:px-6 pt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs uppercase tracking-widest font-semibold text-foreground/80">
                Promos & Events
              </h2>
              <Link
                href="/promo"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:text-primary/80 transition"
              >
                See all
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
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
