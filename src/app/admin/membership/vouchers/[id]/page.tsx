import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ticket, CheckCircle2, Users } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getVoucherTemplateDetail } from "@/lib/membership-actions";
import { getMembershipLevels } from "@/lib/membership";
import { StatCard } from "../../../components/StatCard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatIDR } from "@/lib/utils";
import { GeneratedCodesList } from "./GeneratedCodesList";
import { EditVoucherButton } from "./EditVoucherButton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
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

/** Detail template voucher — aturan + semua kode yang digenerate member. */
export default async function VoucherTemplateDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const [d, levels] = await Promise.all([
    getVoucherTemplateDetail(id).catch(() => null),
    getMembershipLevels(),
  ]);
  if (!d) notFound();

  const levelNames = Object.fromEntries(levels.map((l) => [l.key, l.name]));
  const usedCount = d.instances.filter((i) => i.used_at).length;
  const totalDiscount = d.instances.reduce(
    (s, i) => s + (i.used_at ? (i.discount_applied ?? 0) : 0),
    0
  );

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Back + header */}
        <Link
          href="/admin/membership/vouchers"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Membership Vouchers
        </Link>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              {d.name}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {fmt(d.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px]",
                d.is_active
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "bg-red-500/15 text-red-400 border-red-500/30"
              )}
            >
              {d.is_active ? "Active" : "Inactive"}
            </Badge>
            <EditVoucherButton
              voucher={{
                id: d.id,
                name: d.name,
                discount_type: d.discount_type as "percent" | "fixed",
                discount_value: d.discount_value,
                max_discount: d.max_discount,
                min_spend: d.min_spend,
                level_key: d.level_key,
                valid_days: d.valid_days,
                is_active: d.is_active,
                generated_count: d.instances.length,
                created_at: d.created_at,
              }}
              levelNames={levelNames}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Generated"
            value={`${d.instances.length.toLocaleString("en-US")} codes`}
            sub="unique code per member"
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Used"
            value={`${usedCount.toLocaleString("en-US")} codes`}
            sub={`${formatIDR(totalDiscount)} discount given`}
          />
        </div>

        {/* Aturan template */}
        <Card className="p-5 space-y-2.5">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Ticket className="h-4 w-4 text-primary" /> Voucher rules
          </h2>
          <InfoRow
            label="Discount"
            value={
              d.discount_type === "percent"
                ? `${d.discount_value}% off${d.max_discount ? ` (max ${formatIDR(d.max_discount)})` : ""}`
                : `${formatIDR(d.discount_value)} off`
            }
          />
          <InfoRow
            label="Min. spend"
            value={d.min_spend ? formatIDR(d.min_spend) : "No minimum"}
          />
          <InfoRow
            label="Membership level"
            value={
              d.level_key
                ? (levelNames[d.level_key] ?? d.level_key)
                : "All paid levels"
            }
          />
          <InfoRow label="Validity" value={`${d.valid_days} days after issue`} />
        </Card>

        {/* Kode yang sudah digenerate (client: search + filter + pagination) */}
        <GeneratedCodesList instances={d.instances} />
      </div>
    </main>
  );
}
