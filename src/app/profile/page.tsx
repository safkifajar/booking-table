import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getCurrentUser,
  getCurrentProfile,
  getStaffRole,
} from "@/lib/auth-v2/current";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AvatarUploader } from "./AvatarUploader";
import { ProfileMenuList } from "./ProfileMenuList";

/**
 * Halaman utama profile — list-style menu.
 *
 * Header: avatar besar (uploadable inline) + display name + email
 * Body: list menu (Account, Password, History, Logout)
 * Sub-pages: /profile/account, /profile/password, /profile/sessions
 */
export default async function ProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile");
  }

  const [user, staff] = await Promise.all([
    getCurrentUser(),
    getStaffRole(),
  ]);

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/" aria-label="Kembali ke beranda">
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
          <UserMenu />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Identity card — avatar + name + email + bio + hobi */}
        <section className="rounded-xl border border-border bg-card p-5">
          <AvatarUploader
            initialAvatarUrl={profile.avatarUrl}
            displayName={profile.displayName}
          />
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <div className="space-y-0.5">
              <div className="text-base font-semibold">{profile.displayName}</div>
              <div className="text-xs text-muted-foreground truncate">
                {user?.email}
              </div>
            </div>

            {profile.bio && (
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
                {profile.bio}
              </p>
            )}

            {profile.hobbies && profile.hobbies.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  <Sparkles className="h-3 w-3 text-primary/70" />
                  Hobi & minat
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.hobbies.map((h) => (
                    <Badge key={h} variant="secondary" className="text-[11px]">
                      {h}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Menu list */}
        <ProfileMenuList staffRole={staff?.role ?? null} />
      </div>
    </main>
  );
}
