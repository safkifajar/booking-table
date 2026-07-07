import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import { PrivacyToggleSection } from "./PrivacyToggleSection";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/privacy");
  }

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="Private Account" eyebrow="Privacy" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <PrivacyToggleSection initial={profile.isPrivate} />
      </div>
    </main>
  );
}
