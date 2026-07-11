import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { userHasPassword } from "@/lib/actions";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";
import { PasswordSection } from "../PasswordSection";

export default async function ProfilePasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/password");
  }

  const hasPassword = await userHasPassword();

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader
        title={hasPassword ? "Change Password" : "Set Password"}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <PasswordSection hasPassword={hasPassword} />
      </div>
    </main>
  );
}
