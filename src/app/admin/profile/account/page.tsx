import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ProfileForm } from "@/app/profile/ProfileForm";
import { getHobbyGroups } from "@/lib/hobby-actions";

export default async function AdminProfileAccountPage() {
  const profile = await getCurrentProfile();
  const hobbyGroups = await getHobbyGroups();
  if (!profile) {
    redirect("/login");
  }
  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/admin/profile" aria-label="Kembali ke Profile">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-primary/70">
            Profile
          </div>
          <h1 className="text-2xl font-bold">Account</h1>
        </div>
      </div>

      <div className="max-w-2xl">
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
          initialMusicPref={profile.musicPref ?? ""}
          initialFavFood={profile.favFood ?? ""}
          initialFavDrink={profile.favDrink ?? ""}
          initialHideHistory={profile.hideHistory}
          initialHideLocation={profile.hideLocation}
          initialHideAge={profile.hideAge}
          initialHideSocial={profile.hideSocial}
          initialHobbies={profile.hobbies ?? []}
          hobbyGroups={hobbyGroups}
        />
      </div>
    </div>
  );
}
