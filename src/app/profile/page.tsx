import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ProfileForm } from "./ProfileForm";

export default async function ProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile");
  }

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-primary/70">
              Profil
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {profile.displayName}
            </h1>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <ProfileForm
          initialDisplayName={profile.displayName}
          initialHobbies={profile.hobbies ?? []}
        />
      </div>
    </main>
  );
}
