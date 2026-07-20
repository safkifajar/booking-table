import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin, getPaymentDetail } from "@/lib/admin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, CreditCard, MapPin } from "lucide-react";
import { formatIDR } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

function statusBadgeVariant(
  status: string
): "success" | "warning" | "destructive" | "secondary" {
  if (status === "paid") return "success";
  if (status === "pending") return "warning";
  if (status === "failed") return "destructive";
  return "secondary";
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function PaymentDetailPage({ params }: PageProps) {
  const bar = await requireAdmin();
  const { id } = await params;

  const p = await getPaymentDetail(bar.id, id);
  if (!p) notFound();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {/* Top bar */}
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/payments">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <Card className="p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-border">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-primary/70 mb-1 flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Payment Detail
            </div>
            <div className="font-mono text-sm text-muted-foreground">
              #{p.id.slice(0, 8).toUpperCase()}
            </div>
            <div className="text-2xl font-bold text-primary tabular-nums mt-1">
              {formatIDR(p.amount)}
            </div>
          </div>
          <Badge variant={statusBadgeVariant(p.status)} className="shrink-0">
            {p.status}
          </Badge>
        </div>

        {/* Info pembayaran */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Field label="Method" value={p.method.toUpperCase()} />
          <Field label="Split" value={p.split_mode} />
          <Field label="Payer" value={p.paid_by_name} />
          <Field
            label="External ref"
            value={p.external_ref ?? "—"}
            mono={!!p.external_ref}
          />
          <Field label="Created" value={fmtDateTime(p.created_at)} />
          <Field
            label="Paid at"
            value={p.paid_at ? fmtDateTime(p.paid_at) : "Not paid yet"}
          />
        </div>

        {/* Transaksi meja terkait — bisa diklik ke detail transaksi */}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Table transaction
          </div>
          <Link
            href={`/admin/transactions/${p.session_id}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3 transition hover:bg-muted/40 group"
          >
            <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">
                  #{p.session_id.slice(0, 8).toUpperCase()}
                </span>
                <Badge variant="default" className="text-[10px]">
                  {p.table_label}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {p.session_title ?? "Open Table"} · {p.area_name} · Host:{" "}
                {p.host_name}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-0.5 text-xs">{label}</div>
      <div className={mono ? "font-mono text-xs break-all" : "font-medium"}>
        {value}
      </div>
    </div>
  );
}
