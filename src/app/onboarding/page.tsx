import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getHobbyGroups } from "@/lib/hobby-actions";
import { getPromptTexts } from "@/lib/prompt-actions";
import { OnboardingWizard } from "./OnboardingWizard";

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function OnboardingPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  const { next } = await searchParams;

  // Harus login.
  if (!profile) redirect("/auth?next=/onboarding");
  // Sudah onboarded → tak perlu wizard lagi.
  if (profile.onboarded) redirect(next || "/");

  // Master interests + prompts dari DB (dikelola admin).
  const [interestCatalog, promptOptions] = await Promise.all([
    getHobbyGroups(),
    getPromptTexts(),
  ]);

  return (
    <main className="flex-1 flex items-start justify-center px-4 py-10">
      <OnboardingWizard
        next={next || "/"}
        initialName={profile.displayName.split(/\s+/)[0] ?? ""}
        initialPhotos={profile.photos ?? []}
        interestCatalog={interestCatalog}
        promptOptions={promptOptions}
      />
    </main>
  );
}
