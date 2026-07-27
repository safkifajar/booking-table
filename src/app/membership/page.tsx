import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SohoGlow } from "@/components/ui/soho-glow";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getMembershipLevels, getMembershipStatus } from "@/lib/membership";
import {
  getMyMembershipTransactions,
  getMyPendingMembershipTx,
  getMyVouchers,
} from "@/lib/membership-actions";
import { MembershipView } from "./MembershipView";

export const dynamic = "force-dynamic";

/**
 * Halaman membership customer (PRD Membership M10/M11): status level saat
 * ini, paket yang bisa dibeli/diperpanjang (bayar QRIS + voucher), dan
 * riwayat transaksi.
 */
export default async function MembershipPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth?next=/membership");

  const [status, levels, transactions, pendingTx, vouchers] =
    await Promise.all([
      getMembershipStatus(profile.id),
      getMembershipLevels(),
      getMyMembershipTransactions(),
      getMyPendingMembershipTx(),
      getMyVouchers(),
    ]);

  return (
    <main className="relative flex-1 pb-12">
      <SohoGlow />
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/profile" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="flex-1 min-w-0 text-base sm:text-lg font-semibold truncate">
            Membership
          </h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <MembershipView
          status={{
            key: status.key,
            name: status.name,
            expiresAt: status.expires_at?.toISOString() ?? null,
            expired: status.expired,
          }}
          levels={levels}
          transactions={transactions}
          pendingTx={pendingTx}
          vouchers={vouchers}
        />
      </div>
    </main>
  );
}
