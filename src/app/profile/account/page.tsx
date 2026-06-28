import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import { ProfileForm } from "../ProfileForm";
import { getHobbyGroups } from "@/lib/hobby-actions";

export default async function ProfileAccountPage() {
  const profile = await getCurrentProfile();
  const hobbyGroups = await getHobbyGroups();
  if (!profile) {
    redirect("/auth?next=/profile/account");
  }

  const user = await getCurrentUser();

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Account" eyebrow="Profile" />

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
    </main>
  );
}
