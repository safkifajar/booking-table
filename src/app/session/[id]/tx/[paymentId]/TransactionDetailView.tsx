"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatIDR } from "@/lib/utils";
import { checkPaymentStatus } from "@/lib/actions";
import type { SessionPaymentDetail } from "@/lib/actions";

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function splitModeLabel(m: string): string {
  if (m === "equal") return "Split equally";
  if (m === "itemized") return "Own order";
  if (m === "custom") return "Treat";
  return m;
}

export function TransactionDetailView({
  sessionId,
  detail,
}: {
  sessionId: string;
  detail: SessionPaymentDetail;
}) {
  const router = useRouter();
  const [qrImage, setQrImage] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [status, setStatus] = React.useState(detail.status);

  const isPending = status === "pending";
  const expiresAtMs = detail.expiresAt
    ? new Date(detail.expiresAt).getTime()
    : null;
  const [secondsLeft, setSecondsLeft] = React.useState(
    expiresAtMs ? Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000)) : 0
  );

  // Render QR image from qrString (only if we have it — owner/staff).
  React.useEffect(() => {
    if (!detail.qrString) return;
    let cancelled = false;
    import("qrcode").then((QR) => {
      QR.toDataURL(detail.qrString!, { width: 300, margin: 1 })
        .then((url: string) => {
          if (!cancelled) setQrImage(url);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [detail.qrString]);

  // Countdown + poll status while pending.
  React.useEffect(() => {
    if (!isPending) return;
    const tick = setInterval(() => {
      if (expiresAtMs) {
        setSecondsLeft(Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000)));
      }
    }, 1000);
    const poll = setInterval(async () => {
      try {
        const r = await checkPaymentStatus(detail.id);
        if (r.status !== "pending") {
          setStatus(r.status);
          router.refresh();
        }
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [isPending, expiresAtMs, detail.id, router]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const expired = isPending && expiresAtMs != null && secondsLeft <= 0;

  const statusMeta = expired
    ? { label: "Cancelled", Icon: XCircle, color: "text-muted-foreground", ring: "border-muted-foreground/30 bg-muted/30" }
    : status === "paid"
      ? { label: "Payment successful", Icon: CheckCircle2, color: "text-emerald-400", ring: "border-emerald-500/40 bg-emerald-500/15" }
      : status === "pending"
        ? { label: "Transaction pending", Icon: Clock, color: "text-amber-400", ring: "border-amber-500/40 bg-amber-500/15" }
        : { label: "Cancelled", Icon: XCircle, color: "text-muted-foreground", ring: "border-muted-foreground/30 bg-muted/30" };

  return (
    <main className="min-h-dvh bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <Link
          href={`/session/${sessionId}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-semibold">Transaction Detail</h1>
      </div>

      <div className="mx-auto max-w-md px-4 py-5 space-y-4">
        {/* Status */}
        <Card className="p-6 text-center">
          <div
            className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border ${statusMeta.ring}`}
          >
            <statusMeta.Icon className={`h-8 w-8 ${statusMeta.color}`} />
          </div>
          <div className={`text-lg font-semibold ${statusMeta.color}`}>
            {statusMeta.label}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {fmtDateTime(detail.paidAt ?? detail.createdAt)}
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(detail.id);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            {detail.id}
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </Card>

        {/* Transaction detail rows */}
        <Card className="p-4">
          <h2 className="mb-3 text-center text-sm font-semibold">
            Transaction Detail
          </h2>
          <dl className="space-y-2 text-sm">
            <Row label="Paid by" value={detail.paidByName} />
            <Row label="Type" value={splitModeLabel(detail.splitMode)} />
            <Row label="Method" value={detail.method.toUpperCase()} />
            {detail.isDownPayment && <Row label="Note" value="Down payment (DP)" />}
          </dl>

          {/* Items (itemized only) */}
          {detail.items.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Order details
              </div>
              <div className="space-y-1.5 text-sm">
                {detail.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      {it.quantity}× {it.name}
                    </span>
                    <span className="tabular-nums">{formatIDR(it.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">
                    {formatIDR(detail.itemsSubtotal)}
                  </span>
                </div>
                {detail.taxService > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{detail.chargeLabel || "Tax & Service"}</span>
                    <span className="tabular-nums">
                      {formatIDR(detail.taxService)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Total */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Payment</span>
            <span className="text-xl font-bold text-primary tabular-nums">
              {formatIDR(detail.amount)}
            </span>
          </div>
        </Card>

        {/* Split members summary (bila transaksi bagian dari batch split) */}
        {detail.batchMembers.length > 0 && (
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold">Split status</div>
            <div className="space-y-1.5 text-sm">
              {detail.batchMembers.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground truncate">{m.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums">{formatIDR(m.amount)}</span>
                    <span
                      className={
                        m.status === "paid"
                          ? "text-[11px] text-emerald-400"
                          : m.status === "pending"
                            ? "text-[11px] text-amber-400"
                            : "text-[11px] text-muted-foreground"
                      }
                    >
                      {m.status === "paid"
                        ? "Paid"
                        : m.status === "pending"
                          ? "Pending"
                          : "Cancelled"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* QRIS (pending + we have qr) */}
        {isPending && !expired && detail.qrString && (
          <Card className="p-5 text-center">
            <div className="mb-2 text-sm font-semibold">Scan to pay (QRIS)</div>
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrImage}
                alt="QRIS"
                className="mx-auto h-64 w-64 rounded-lg bg-white p-2"
              />
            ) : (
              <div className="mx-auto flex h-64 w-64 items-center justify-center text-sm text-muted-foreground">
                Generating QR…
              </div>
            )}
            {expiresAtMs != null && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-sm font-medium text-amber-400">
                <Clock className="h-4 w-4" />
                Pay before {mm}:{ss}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Waiting for payment… this page updates automatically.
            </p>
          </Card>
        )}

        {/* Pending but no QR (viewer is not the owner) */}
        {isPending && !expired && !detail.qrString && (
          <Card className="p-4 text-center text-sm text-muted-foreground">
            This transaction is still pending. Only the payer (or staff) can
            display its QR.
          </Card>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}
