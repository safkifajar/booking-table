import { requireAdmin } from "@/lib/admin";
import { getHobbiesList, getHobbyCategories } from "@/lib/hobby-actions";
import { HobbiesManager } from "./HobbiesManager";

export default async function AdminHobbiesPage() {
  await requireAdmin();
  const [hobbiesList, categories] = await Promise.all([
    getHobbiesList(),
    getHobbyCategories(),
  ]);

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">
            Konten
          </div>
          <h1 className="text-2xl font-semibold">Hobi &amp; Minat</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola pilihan hobi & minat yang bisa dipilih customer di profil &
            onboarding.
          </p>
        </div>

        <HobbiesManager hobbiesList={hobbiesList} categories={categories} />
      </div>
    </main>
  );
}
