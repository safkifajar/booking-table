import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import { ProfileForm } from "../ProfileForm";

export default async function ProfileAccountPage() {
  const profile = await getCurrentProfile();
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
          initialHobbies={profile.hobbies ?? []}
        />
      </div>
    </main>
  );
}
