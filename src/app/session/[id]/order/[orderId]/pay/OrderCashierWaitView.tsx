"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cancelPayment } from "@/lib/actions";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Layar tunggu "Pay at the cashier" untuk ORDER MEJA AKTIF — instruksi + countdown
 * 10 menit + poll refresh. Sama tampilan dgn CashierWaitView (booking), TAPI:
 * - Batal/kembali → ke DETAIL ORDER (bukan denah). Meja tetap terbuka.
 * - Waktu habis → batalkan pembayaran (order dibatalkan, item void) lalu balik
 *   ke detail order.
 */
export function OrderCashierWaitView({
  paymentId,
  amount,
  secondsLeft,
  sessionId,
  orderId,
  tableLabel,
}: {
  paymentId: string;
  amount: number;
  secondsLeft: number;
  sessionId: string;
  orderId: string;
  tableLabel?: string;
}) {
  const router = useRouter();
  const [left, setLeft] = React.useState(secondsLeft);
  const [cancelling, setCancelling] = React.useState(false);
  const expiredHandled = React.useRef(false);
  const orderHref = `/session/${sessionId}/order/${orderId}`;

  // Countdown lokal (server tetap otoritatif via expireOverduePayAtCashierOrders).
  React.useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll: refresh tiap 5 dtk — saat kasir konfirmasi, server sudah menyelesaikan
  // order; halaman pay ini akan redirect ke detail order (payment tak pending lagi).
  React.useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);

  // Tombol kembali (HP/browser) → ke DETAIL ORDER (bukan history.back()). Order
  // TIDAK dibatalkan di sini — sweep server yang mengurus timeout.
  React.useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPop = () => router.replace(orderHref);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router, orderHref]);

  // Waktu habis → batalkan (idempoten; kalau ternyata sudah paid → ke detail).
  React.useEffect(() => {
    if (left > 0 || expiredHandled.current) return;
    expiredHandled.current = true;
    void (async () => {
      try {
        const res = await cancelPayment(paymentId);
        if (res.status === "paid") {
          router.replace(orderHref);
          return;
        }
      } catch {
        // Server sweep tetap membereskan — lanjut redirect.
      }
      toast.error("Payment cancelled — cashier confirmation time ran out");
      router.replace(orderHref);
    })();
  }, [left, paymentId, orderHref, router]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await cancelPayment(paymentId);
      if (res.status === "paid") {
        router.replace(orderHref);
        return;
      }
      toast.success("Payment cancelled");
      router.replace(orderHref);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel"));
      setCancelling(false);
    }
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6 space-y-5 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Banknote className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold">Pay at the cashier</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Go to the cashier desk{tableLabel ? (
              <>
                , mention table{" "}
                <span className="font-semibold text-foreground">{tableLabel}</span>,
              </>
            ) : ""}{" "}
            and pay to complete this order.
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Amount to pay
          </p>
          <p className="text-2xl font-bold text-gold-gradient tabular-nums">
            {formatIDR(amount)}
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-xs text-amber-400">Time left to confirm</p>
          <p className="text-3xl font-bold tabular-nums text-amber-400 mt-0.5">
            {mm}:{ss}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            If time runs out, this order is cancelled. Your table stays open.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for cashier confirmation…
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-full"
            disabled={cancelling}
            onClick={handleCancel}
          >
            {cancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Cancel this payment
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => router.replace(orderHref)}
          >
            Back to order
          </Button>
        </div>
      </Card>
    </div>
  );
}
