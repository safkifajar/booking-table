import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ProfileMenuList } from "./ProfileMenuList";
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
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile");
  }
  // Belum selesai onboarding → paksa ke wizard (mulai layar gender).
  if (!profile.onboarded) redirect("/onboarding");

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
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-primary/70">
              Profile
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {profile.displayName}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Menu list */}
        <ProfileMenuList
          avatarUrl={profile.avatarUrl ?? profile.photos[0] ?? null}
          displayName={profile.displayName}
          isPrivate={profile.isPrivate}
        />
      </div>
    </main>
  );
}
