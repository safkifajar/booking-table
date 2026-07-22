import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth-v2/current";
import { ProfileMenuList } from "./ProfileMenuList";
import { getMembershipStatus } from "@/lib/membership";
import { getMyPendingInviteCount } from "@/lib/actions";
import { getBarBySlug } from "@/lib/queries";
import { HomeBottomNav } from "@/components/HomeBottomNav";
import { NotificationBell } from "@/components/NotificationBell";
import { SohoGlow } from "@/components/ui/soho-glow";

/**
 * Halaman utama profile — list-style menu.
 *
 * Header: back + display name
 * Body: list menu (Account, Password, History, Notifications, Logout).
 * Data profil lengkap (foto, bio, interests, dll) tampil di /profile/account.
 * Sub-pages: /profile/account, /profile/password, /profile/sessions, /profile/stories
 */
export default async function ProfilePage() {
  const [profile, user] = await Promise.all([
    getCurrentProfile(),
    getCurrentUser(),
  ]);
  if (!profile) {
    redirect("/auth?next=/profile");
  }
  // Belum selesai onboarding → paksa ke wizard (mulai layar gender).
  if (!profile.onboarded) redirect("/onboarding");

  // Badge level membership EFEKTIF (PRD Membership M12) + jumlah undangan pending
  // + bar (untuk bottom nav — barId dipakai tombol Story).
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const [membership, pendingInviteCount, bar] = await Promise.all([
    getMembershipStatus(profile.id),
    getMyPendingInviteCount(),
    getBarBySlug(barSlug),
  ]);

  return (
    <main className="relative flex-1 pb-24">
      <SohoGlow />
      {/* Header — samakan dgn Home/Network/Booking: logo SOHO + nama halaman +
          bell notifikasi. */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
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
            <span className="text-sm font-semibold">Profile</span>
          </Link>
          <div className="flex-1" />
          <NotificationBell userId={profile.id} />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Menu list */}
        <ProfileMenuList
          avatarUrl={profile.avatarUrl ?? profile.photos[0] ?? null}
          displayName={profile.displayName}
          username={profile.username}
          email={user?.email ?? null}
          isPrivate={profile.isPrivate}
          membership={{
            key: membership.key,
            name: membership.name,
            expiresAt: membership.expires_at?.toISOString() ?? null,
          }}
          pendingInviteCount={pendingInviteCount}
        />
      </div>

      {/* Bottom nav — tab Profile ter-highlight otomatis (isActive /profile). */}
      {bar && (
        <HomeBottomNav
          barId={bar.id}
          isAnon={false}
          avatarUrl={profile.avatarUrl ?? profile.photos[0] ?? null}
          displayName={profile.displayName}
        />
      )}
    </main>
  );
}
