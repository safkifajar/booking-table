import { CheckCircle2, AlertCircle, Crown } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { listMembershipTransactions } from "@/lib/membership-actions";
import { StatCard } from "../../components/StatCard";
import { formatIDR } from "@/lib/utils";
import { ExportCsvButton } from "./ExportCsvButton";
import { MembershipTxList } from "./MembershipTxList";

export const dynamic = "force-dynamic";

/** Daftar pembayaran membership (PRD Membership M9) — terpisah dari payments F&B. */
export default async function AdminMembershipTxPage() {
  await requireAdmin();
  const { rows, total } = await listMembershipTransactions({ pageSize: 500 });

  const paidRows = rows.filter((r) => r.status === "paid");
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const paidTotal = paidRows.reduce((s, r) => s + r.amount, 0);

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Membership Transactions
            </h1>
            <p className="text-xs text-muted-foreground">
              {total} transactions · {formatIDR(paidTotal)} paid
            </p>
          </div>
          <ExportCsvButton rows={rows} />
        </div>

        {/* Status pembayaran — monitoring paid vs pending (pola Transactions) */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Paid"
            value={`${paidRows.length.toLocaleString("en-US")} transactions`}
          />
          <StatCard
            icon={<AlertCircle className="h-4 w-4" />}
            label="Pending"
            value={`${pendingCount.toLocaleString("en-US")} transactions`}
          />
        </div>

        {/* Search + filter + tabel + pagination (client) */}
        <MembershipTxList rows={rows} />
      </div>
    </main>
  );
}
