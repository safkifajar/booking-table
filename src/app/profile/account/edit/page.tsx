import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { getHobbyGroups } from "@/lib/hobby-actions";
import { getPromptTexts } from "@/lib/prompt-actions";
import { ProfileSubpageHeader } from "../../ProfileSubpageHeader";
import { ProfileForm } from "../../ProfileForm";

/**
 * Form EDIT profil. Tampilan VIEW (CMB-style) ada di /profile/account.
 */
export default async function ProfileAccountEditPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/account/edit");
  }

  const [user, interestCatalog, promptOptions] = await Promise.all([
    getCurrentUser(),
    getHobbyGroups(),
    getPromptTexts(),
  ]);

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader
        title="Edit profile"
        backHref="/profile/account"
      />

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
          initialHobbies={profile.hobbies ?? []}
          initialPhotos={profile.photos ?? []}
          initialPrompts={profile.prompts ?? []}
          interestCatalog={interestCatalog}
          promptOptions={promptOptions}
        />
      </div>
    </main>
  );
}
