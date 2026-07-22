import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth-v2/current";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ProfileMenuList } from "./ProfileMenuList";
import { getMembershipStatus } from "@/lib/membership";
import { getMyPendingInviteCount } from "@/lib/actions";
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

  // Badge level membership EFEKTIF (PRD Membership M12) + jumlah undangan pending.
  const [membership, pendingInviteCount] = await Promise.all([
    getMembershipStatus(profile.id),
    getMyPendingInviteCount(),
  ]);

  return (
    <main className="relative flex-1 pb-12">
      <SohoGlow />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/" aria-label="Back to home">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="flex-1 min-w-0 text-base sm:text-lg font-semibold truncate">
            Profile
          </h1>
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
    </main>
  );
}
