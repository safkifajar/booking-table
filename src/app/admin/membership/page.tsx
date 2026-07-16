import { requireAdmin } from "@/lib/admin";
import { getMembershipLevels } from "@/lib/membership";
import { LevelsManager } from "./LevelsManager";

export const dynamic = "force-dynamic";

/**
 * Kelola level membership (PRD Membership M2/M3): nama, harga, periode,
 * deskripsi. key/rank immutable; basic terkunci gratis & non-purchasable.
 */
export default async function AdminMembershipPage() {
  await requireAdmin();
  const levels = await getMembershipLevels();

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Membership Levels</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Display names & pricing are editable. Level keys, order, and
            visibility rules are fixed: members can see their own level and
            below; friends always see each other.
          </p>
        </div>
        <LevelsManager levels={levels} />
      </div>
    </main>
  );
}
