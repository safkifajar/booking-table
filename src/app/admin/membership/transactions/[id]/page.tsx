import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Crown,
  UserCircle,
  Receipt,
  Ticket,
  ArrowRight,
} from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getMembershipTxDetail } from "@/lib/membership-actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatIDR } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const KIND_LABEL: Record<string, string> = {
  purchase: "Purchase",
  renewal: "Renewal",
  admin_grant: "Admin grant",
};

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  refunded: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  });
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** Detail satu transaksi membership — rincian tagihan, periode, voucher benefit. */
export default async function MembershipTxDetailPage({ params }: PageProps) {
  // Server component: dirender sekali per permintaan (lihat catatan di
  // MembershipBanner). Diambil sekali supaya semua voucher dinilai
  // kedaluwarsa dari titik waktu yang sama.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  await requireAdmin();
  const { id } = await params;
  const d = await getMembershipTxDetail(id).catch(() => null);
  if (!d) notFound();

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Back + header */}
        <Link
          href="/admin/membership/transactions"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Membership Transactions
        </Link>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              <span className="font-mono">#{d.id.slice(0, 8).toUpperCase()}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {KIND_LABEL[d.kind] ?? d.kind} · {d.level_name} ·{" "}
              {fmt(d.created_at)}
            </p>
          </div>
          <Badge
            variant="secondary"
            className={cn("text-[10px]", STATUS_STYLE[d.status])}
          >
            {d.status}
          </Badge>
        </div>

        {/* Rincian tagihan (snapshot saat transaksi dibuat) */}
        <Card className="p-5 space-y-2.5">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" /> Billing
          </h2>
          <InfoRow label="Base price" value={formatIDR(d.base_amount)} />
          {d.tax_amount > 0 && (
            <InfoRow label="Tax" value={formatIDR(d.tax_amount)} />
          )}
          {d.service_amount > 0 && (
            <InfoRow
              label="Service charge"
              value={formatIDR(d.service_amount)}
            />
          )}
          <div className="border-t border-border pt-2.5">
            <InfoRow
              label="Total"
              value={
                <span className="text-base font-bold text-gold-gradient tabular-nums">
                  {formatIDR(d.amount)}
                </span>
              }
            />
          </div>
          <InfoRow
            label="Method"
            value={<span className="uppercase">{d.method}</span>}
          />
          {d.external_ref && (
            <InfoRow
              label="Gateway ref"
              value={<span className="font-mono text-xs">{d.external_ref}</span>}
            />
          )}
          {d.paid_at && <InfoRow label="Paid at" value={fmt(d.paid_at)} />}
        </Card>

        {/* Customer */}
        <Card className="p-5 space-y-2.5">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <UserCircle className="h-4 w-4 text-primary" /> Customer
          </h2>
          <InfoRow
            label="Name"
            value={
              <Link
                href={`/admin/users/${d.customer_id}`}
                className="hover:text-primary transition"
              >
                {d.customer_name}
              </Link>
            }
          />
          <InfoRow label="Email" value={d.customer_email} />
        </Card>

        {/* Membership yang diberikan */}
        <Card className="p-5 space-y-2.5">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary" /> Membership
          </h2>
          <InfoRow
            label="Level"
            value={
              <Badge variant="outline" className="text-[10px]">
                {d.level_name}
              </Badge>
            }
          />
          <InfoRow label="Type" value={KIND_LABEL[d.kind] ?? d.kind} />
          <InfoRow label="Period start" value={fmt(d.period_start)} />
          <InfoRow
            label="Period end"
            value={d.period_end ? fmt(d.period_end) : "Lifetime"}
          />
          {d.granted_by_name && (
            <InfoRow label="Granted by" value={d.granted_by_name} />
          )}
        </Card>

        {/* Voucher benefit yang digenerate dari transaksi ini */}
        <Card className="p-5 space-y-2.5">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Ticket className="h-4 w-4 text-primary" /> Vouchers generated
          </h2>
          {d.vouchers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No vouchers were generated from this transaction.
            </p>
          ) : (
            <div className="space-y-2">
              {d.vouchers.map((v) => {
                const expired =
                  !v.used_at && new Date(v.expires_at).getTime() < renderedAt;
                const usable = v.used_at || v.reserved;
                const inner = (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition">
                    <div className="min-w-0">
                      <span className="font-mono text-xs block">{v.code}</span>
                      <span className="text-xs text-muted-foreground block truncate">
                        {v.name} · expires{" "}
                        {new Date(v.expires_at).toLocaleDateString("en-US", {
                          dateStyle: "medium",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px]",
                          v.used_at
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : v.reserved
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              : expired
                                ? "bg-red-500/15 text-red-400 border-red-500/30"
                                : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                        )}
                      >
                        {v.used_at
                          ? "used"
                          : v.reserved
                            ? "reserved"
                            : expired
                              ? "expired"
                              : "active"}
                      </Badge>
                      {usable && (
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                );
                return usable ? (
                  <Link
                    key={v.id}
                    href={`/admin/membership/vouchers/usage/${v.id}`}
                    className="block"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={v.id}>{inner}</div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
