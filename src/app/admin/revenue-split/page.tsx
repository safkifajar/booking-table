import { requireAdmin } from "@/lib/admin";
import {
  getSplitConfig,
  getSplitSettlementReport,
} from "@/lib/revenue-split-actions";
import { SplitManager } from "./SplitManager";

export const dynamic = "force-dynamic";

/**
 * Halaman Bagi Hasil (PRD bagi-hasil D5 rev) — TANPA entry point di menu
 * mana pun; akses via URL langsung, guard role admin (tanpa whitelist
 * email — keputusan user).
 */
export default async function RevenueSplitPage() {
  await requireAdmin();

  const config = await getSplitConfig();
  const report = await getSplitSettlementReport();

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Revenue Split</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Service-fee allocation rules. Private page — changes are versioned
            and audited; history never changes.
          </p>
        </div>
        <SplitManager config={config} report={report} />
      </div>
    </main>
  );
}
