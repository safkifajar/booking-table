import { requireAdmin } from "@/lib/admin";
import { getPrompts } from "@/lib/prompt-actions";
import { PromptsManager } from "./PromptsManager";

export default async function AdminPromptsPage() {
  await requireAdmin();
  const prompts = await getPrompts();

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">
            Content
          </div>
          <h1 className="text-2xl font-semibold">Prompts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola daftar pertanyaan ice-breaker yang bisa dijawab customer di
            profil &amp; onboarding.
          </p>
        </div>

        <PromptsManager prompts={prompts} />
      </div>
    </main>
  );
}
