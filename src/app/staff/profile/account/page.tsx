import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ProfileForm } from "@/app/profile/ProfileForm";

export default async function StaffProfileAccountPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const user = await getCurrentUser();

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/staff/profile" aria-label="Back to Profile">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-primary/70">
              Profile
            </div>
            <h1 className="text-base sm:text-lg font-semibold">Account</h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <ProfileForm
          email={user?.email ?? ""}
          initialDisplayName={profile.displayName}
          initialPhone={profile.phone ?? ""}
          initialBirthDate={profile.birthDate ?? ""}
          initialBio={profile.bio ?? ""}
          initialGender={(profile.gender as "" | "male" | "female") ?? ""}
          initialInterestedIn={
            (profile.interestedIn as "" | "male" | "female" | "both") ?? ""
          }
          initialSocialLink={profile.socialLink ?? ""}
          initialArea={profile.area ?? ""}
          initialLookingFor={profile.lookingFor ?? ""}
          initialEducation={profile.education ?? ""}
          initialHeightCm={profile.heightCm ?? null}
          initialReligion={profile.religion ?? ""}
          initialMusicPref={profile.musicPref ?? ""}
          initialFavFood={profile.favFood ?? ""}
          initialFavDrink={profile.favDrink ?? ""}
          initialHideHistory={profile.hideHistory}
          initialHideLocation={profile.hideLocation}
          initialHideAge={profile.hideAge}
          initialHideSocial={profile.hideSocial}
          initialHobbies={profile.hobbies ?? []}
          initialPhotos={profile.photos ?? []}
          initialPrompts={profile.prompts ?? []}
        />
      </div>
    </main>
  );
}
