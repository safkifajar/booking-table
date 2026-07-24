import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Ticket,
  UserCircle,
  Receipt,
  ArrowRight,
} from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getVoucherUsageDetail } from "@/lib/membership-actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatIDR } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

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

/** Detail pemakaian satu voucher — aturan, pemilik, payment & transaksinya. */
export default async function VoucherUsageDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const d = await getVoucherUsageDetail(id).catch(() => null);
  if (!d) notFound();

  const ruleLabel =
    d.discount_type === "percent"
      ? `${d.discount_value}% off${d.max_discount ? ` (max ${formatIDR(d.max_discount)})` : ""}`
      : `${formatIDR(d.discount_value)} off`;

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Back + header */}
        <Link
          href="/admin/membership/vouchers/usage"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voucher Usage
        </Link>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              <span className="font-mono">{d.code}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {d.voucher_name}
            </p>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px]",
              d.usage_status === "used"
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/15 text-amber-400 border-amber-500/30"
            )}
          >
            {d.usage_status}
          </Badge>
        </div>

        {/* Potongan yang diberikan — angka utama */}
        <Card className="p-5">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Discount applied
          </p>
          <p className="text-2xl font-bold text-gold-gradient tabular-nums">
            {d.discount_applied != null ? formatIDR(d.discount_applied) : "—"}
          </p>
          {d.used_at && (
            <p className="text-xs text-muted-foreground mt-1">
              Used {fmt(d.used_at)}
            </p>
          )}
          {d.usage_status === "reserved" && (
            <p className="text-xs text-amber-400 mt-1">
              Attached to a pending payment — becomes final when the payment is
              paid.
            </p>
          )}
        </Card>

        {/* Aturan voucher (snapshot saat digenerate) */}
        <Card className="p-5 space-y-2.5">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Ticket className="h-4 w-4 text-primary" /> Voucher rules
          </h2>
          <InfoRow label="Discount" value={ruleLabel} />
          <InfoRow
            label="Min. spend"
            value={d.min_spend ? formatIDR(d.min_spend) : "No minimum"}
          />
          <InfoRow label="Received" value={fmt(d.received_at)} />
          <InfoRow label="Expires" value={fmt(d.expires_at)} />
        </Card>

        {/* Pemilik voucher */}
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

        {/* Payment & transaksi tempat voucher dipakai */}
        <Card className="p-5 space-y-2.5">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" /> Payment & transaction
          </h2>
          {d.payment_id ? (
            <>
              <InfoRow
                label="Paid by customer"
                value={
                  d.payment_amount != null ? formatIDR(d.payment_amount) : "—"
                }
              />
              <InfoRow
                label="Method"
                value={<span className="uppercase">{d.payment_method}</span>}
              />
              <InfoRow label="Payment status" value={d.payment_status} />
              {d.payment_paid_at && (
                <InfoRow label="Paid at" value={fmt(d.payment_paid_at)} />
              )}
              {d.session_id && (
                <InfoRow
                  label="Transaction"
                  value={
                    <span className="font-mono text-xs">
                      #{d.session_id.slice(0, 8).toUpperCase()}
                    </span>
                  }
                />
              )}
              {d.table_label && (
                <InfoRow
                  label="Table"
                  value={
                    <Badge variant="default" className="text-[10px]">
                      {d.table_label}
                      {d.area_name ? ` · ${d.area_name}` : ""}
                    </Badge>
                  }
                />
              )}
              {d.session_id && (
                <div className="pt-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/admin/transactions/${d.session_id}`}>
                      View transaction detail
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No payment attached — the voucher was released (payment failed or
              was cancelled).
            </p>
          )}
        </Card>
      </div>
    </main>
  );
}
