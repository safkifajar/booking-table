"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, QrCode } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";
import { PaymentSheet } from "@/components/session/PaymentSheet";
import {
  payShare,
  createSplitBatch,
  checkPaymentStatus,
  type OrderDetail,
} from "@/lib/actions";
import type { PaymentMethod } from "@/types/db";
import { toast } from "sonner";

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export function OrderDetailView({ detail }: { detail: OrderDetail }) {
  const router = useRouter();
  const [paySheet, setPaySheet] = React.useState(false);
  // QR yang sedang ditampilkan inline (payment id + qr).
  const [activeQr, setActiveQr] = React.useState<{
    paymentId: string;
    qrString: string;
    expiresAt: string | null;
  } | null>(null);
  const [qrImage, setQrImage] = React.useState<string | null>(null);

  // Render QR image saat activeQr berubah.
  React.useEffect(() => {
    let cancelled = false;
    if (!activeQr) {
      // async agar tak setState sinkron di dalam effect.
      Promise.resolve().then(() => !cancelled && setQrImage(null));
      return () => {
        cancelled = true;
      };
    }
    import("qrcode").then((QR) => {
      QR.toDataURL(activeQr.qrString, { width: 280, margin: 1 })
        .then((url: string) => !cancelled && setQrImage(url))
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [activeQr]);

  // Waktu sekarang (di-refresh tiap 10 dtk) utk cek expired tanpa Date.now() saat render.
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => !cancelled && setNow(Date.now()));
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Poll status saat ada QR aktif (pending).
  React.useEffect(() => {
    if (!activeQr) return;
    const poll = setInterval(async () => {
      try {
        const r = await checkPaymentStatus(activeQr.paymentId);
        if (r.status !== "pending") {
          setActiveQr(null);
          router.refresh();
        }
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [activeQr, router]);

  // Single payment (treat/staff) → buat 1 payment → tampilkan QR inline.
  async function handleSingle(amount: number, method: PaymentMethod) {
    try {
      const result = await payShare({
        sessionId: detail.sessionId,
        orderId: detail.id,
        amount,
        method,
        splitMode: "custom",
      });
      setPaySheet(false);
      if (result.qrString && result.status === "pending") {
        setActiveQr({ paymentId: result.paymentId, qrString: result.qrString, expiresAt: result.expiresAt });
      } else {
        toast.success(result.status === "paid" ? "Payment successful" : "Payment is being processed");
      }
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Payment failed"));
    }
  }
  // Batch (split/my-order) → generate N QRIS → tampilkan QR host inline.
  async function handleBatch(mode: "equal" | "itemized", method: PaymentMethod) {
    try {
      const { results } = await createSplitBatch({
        sessionId: detail.sessionId,
        orderId: detail.id,
        mode,
        method,
      });
      setPaySheet(false);
      const created = results.filter((r) => r.status === "pending" || r.status === "paid");
      const mine = created.find((r) => r.memberId === detail.myMemberId) ?? created[0];
      if (created.length > 0) {
        toast.success(`QRIS created for ${created.length} member${created.length > 1 ? "s" : ""}`);
        if (mine?.qrString && mine.paymentId) {
          setActiveQr({ paymentId: mine.paymentId, qrString: mine.qrString, expiresAt: mine.expiresAt });
        }
      } else {
        toast.info("No QRIS created (already have active ones?)");
      }
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to create split"));
    }
  }

  const statusLabel =
    detail.status === "paid" ? "Paid" : detail.status === "unpaid" ? "Unpaid" : detail.status === "closed" ? "Closed" : detail.status;

  return (
    <main className="min-h-dvh bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <Link
          href={`/session/${detail.sessionId}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-semibold">Order Detail</h1>
      </div>

      <div className="mx-auto max-w-md px-4 py-5 space-y-4">
        {/* Order info */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm">#{detail.id.slice(0, 8).toUpperCase()}</span>
            <Badge
              variant={detail.status === "paid" ? "success" : detail.status === "unpaid" ? "warning" : "secondary"}
              className="text-[10px]"
            >
              {statusLabel}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {fmtTime(detail.paidAt ?? detail.createdAt)}
          </div>
        </Card>

        {/* Items */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">Items</h2>
          <div className="space-y-1.5 text-sm">
            {detail.items.map((i) => (
              <div key={i.id} className="flex justify-between gap-2">
                <span className="text-muted-foreground truncate">
                  {i.quantity}× {i.name}{" "}
                  <span className="text-[10px]">· {i.added_by}</span>
                </span>
                <span className="tabular-nums shrink-0">{formatIDR(i.quantity * i.unit_price)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-border pt-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatIDR(detail.subtotal)}</span>
            </div>
            {detail.chargePercent > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tax &amp; Service ({detail.chargePercent}%)</span>
                <span className="tabular-nums">{formatIDR(detail.charge)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold pt-1 border-t border-border">
              <span>Total</span>
              <span className="text-primary tabular-nums">{formatIDR(detail.total)}</span>
            </div>
            {detail.paid > 0 && detail.outstanding > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Remaining</span>
                <span className="tabular-nums text-primary">{formatIDR(detail.outstanding)}</span>
              </div>
            )}
          </div>
        </Card>

        {/* QRIS inline (kalau aktif) */}
        {activeQr && (
          <Card className="p-5 text-center">
            <div className="mb-2 text-sm font-semibold">Scan to pay (QRIS)</div>
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImage} alt="QRIS" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
            ) : (
              <div className="mx-auto flex h-56 w-56 items-center justify-center text-sm text-muted-foreground">
                Generating QR…
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Waiting for payment… this page updates automatically.
            </p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setActiveQr(null)}>
              Close QR
            </Button>
          </Card>
        )}

        {/* Pay button */}
        {detail.canPay && !activeQr && (
          <Button variant="gold" size="lg" className="w-full" onClick={() => setPaySheet(true)}>
            Pay this order
          </Button>
        )}
        {detail.status === "paid" && detail.outstanding <= 0 && (
          <Card className="p-4 bg-emerald-500/10 border-emerald-500/30 text-sm text-emerald-400 font-medium text-center">
            Order fully paid
          </Card>
        )}

        {/* Payment history */}
        {detail.payments.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-2">Payment history</h2>
            <div className="space-y-2">
              {detail.payments.map((p) => {
                const expired =
                  p.status === "pending" && p.expires_at != null && now > 0 && new Date(p.expires_at).getTime() <= now;
                const canShowQr = p.status === "pending" && !expired && p.qr_string;
                return (
                  <Card key={p.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{p.paid_by}</span>
                          <Badge variant={p.is_down_payment ? "default" : "secondary"} className="text-[9px] px-1">
                            {p.is_down_payment ? "DP" : "Bill"}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.method.toUpperCase()} · {fmtTime(p.paid_at ?? p.created_at)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-primary tabular-nums">{formatIDR(p.amount)}</div>
                        <Badge
                          variant={p.status === "paid" ? "success" : p.status === "pending" && !expired ? "warning" : "secondary"}
                          className="text-[10px]"
                        >
                          {p.status === "paid" ? "Paid" : expired ? "Cancelled" : p.status === "pending" ? "Pending" : "Cancelled"}
                        </Badge>
                      </div>
                    </div>
                    {canShowQr && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveQr({ paymentId: p.id, qrString: p.qr_string!, expiresAt: p.expires_at })
                        }
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition"
                      >
                        <QrCode className="h-3.5 w-3.5" /> Show QR
                      </button>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {paySheet && (
        <PaymentSheet
          items={detail.items.map((i) => ({
            id: i.id,
            quantity: i.quantity,
            unit_price: i.unit_price,
            added_by: { member_id: detail.myMemberId ?? "" },
          }))}
          membersCount={detail.membersCount}
          myMemberId={detail.myMemberId}
          total={detail.total}
          remaining={detail.outstanding}
          payFullOnly={detail.isStaff && !detail.isHost}
          onClose={() => setPaySheet(false)}
          onSingle={handleSingle}
          onBatch={handleBatch}
        />
      )}
    </main>
  );
}
