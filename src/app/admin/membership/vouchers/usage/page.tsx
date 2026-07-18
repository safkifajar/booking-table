import { Ticket, CheckCircle2, Clock3 } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { listVoucherUsage } from "@/lib/membership-actions";
import { StatCard } from "../../../components/StatCard";
import { formatIDR } from "@/lib/utils";
import { VoucherUsageList } from "./VoucherUsageList";

export const dynamic = "force-dynamic";

/** Pemakaian voucher member di transaksi bill — siapa, transaksi mana, berapa. */
export default async function VoucherUsagePage() {
  await requireAdmin();
  const rows = await listVoucherUsage();

  const used = rows.filter((r) => r.usage_status === "used");
  const reserved = rows.filter((r) => r.usage_status === "reserved");
  const totalDiscount = used.reduce((s, r) => s + (r.discount_applied ?? 0), 0);

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            Voucher Usage
          </h1>
          <p className="text-xs text-muted-foreground">
            {used.length} vouchers used · {formatIDR(totalDiscount)} total
            discount
          </p>
        </div>

        {/* Stats — used vs reserved (menempel di payment yang masih pending) */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Used"
            value={`${used.length.toLocaleString("en-US")} vouchers`}
            sub={`${formatIDR(totalDiscount)} discount given`}
          />
          <StatCard
            icon={<Clock3 className="h-4 w-4" />}
            label="Reserved"
            value={`${reserved.length.toLocaleString("en-US")} vouchers`}
            sub="attached to pending payments"
          />
        </div>

        {/* Search + filter + tabel (client) */}
        <VoucherUsageList rows={rows} />
      </div>
    </main>
  );
}
