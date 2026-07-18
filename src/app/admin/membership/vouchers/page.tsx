import Link from "next/link";
import { Ticket } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getMembershipLevels } from "@/lib/membership";
import { listMembershipVouchers } from "@/lib/membership-actions";
import { Button } from "@/components/ui/button";
import { VouchersManager } from "./VouchersManager";

export const dynamic = "force-dynamic";

/** Kelola voucher diskon membership (PRD Membership M7). */
export default async function AdminVouchersPage() {
  await requireAdmin();
  const [vouchers, levels] = await Promise.all([
    listMembershipVouchers(),
    getMembershipLevels(),
  ]);

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Membership Vouchers
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Discount codes for membership purchases & renewals. Used vouchers
              can only be deactivated, not deleted.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/membership/vouchers/usage">
              <Ticket className="h-4 w-4" /> Voucher usage
            </Link>
          </Button>
        </div>
        <VouchersManager
          vouchers={vouchers}
          levelNames={Object.fromEntries(levels.map((l) => [l.key, l.name]))}
        />
      </div>
    </main>
  );
}
