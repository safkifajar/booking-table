"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, Clock, Loader2, X, ArrowLeft } from "lucide-react";
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
  void orderId; // dipakai di route (params), tak untuk navigasi kembali
  // Kembali/selesai → tab Bill sesi (daftar Orders), bukan detail order —
  // pending tetap terlihat di sana & konsisten dgn tempat customer memulai.
  const backHref = `/session/${sessionId}?tab=bill`;

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
    const onPop = () => router.replace(backHref);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router, backHref]);

  // Waktu habis → batalkan (idempoten; kalau ternyata sudah paid → ke detail).
  React.useEffect(() => {
    if (left > 0 || expiredHandled.current) return;
    expiredHandled.current = true;
    void (async () => {
      try {
        const res = await cancelPayment(paymentId);
        if (res.status === "paid") {
          router.replace(backHref);
          return;
        }
      } catch {
        // Server sweep tetap membereskan — lanjut redirect.
      }
      toast.error("Payment cancelled. Cashier confirmation time ran out");
      router.replace(backHref);
    })();
  }, [left, paymentId, backHref, router]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await cancelPayment(paymentId);
      if (res.status === "paid") {
        router.replace(backHref);
        return;
      }
      toast.success("Payment cancelled");
      router.replace(backHref);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel"));
      setCancelling(false);
    }
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card/40 p-6 sm:p-8 text-center">
        {/* Ikon dengan glow */}
        <div className="relative mx-auto mb-6 h-24 w-24">
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" />
          <div className="relative h-full w-full rounded-full border border-primary/40 bg-primary/[0.06] flex items-center justify-center shadow-[0_0_40px_-8px_hsl(var(--primary)/0.6)]">
            <Banknote className="h-9 w-9 text-primary" />
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-tight">Pay at the cashier</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Go to the cashier desk
          {tableLabel ? (
            <>
              , mention table{" "}
              <span className="font-semibold text-primary">{tableLabel}</span>,
            </>
          ) : (
            ""
          )}{" "}
          and pay to complete this order.
        </p>

        {/* Amount — kartu merah */}
        <div className="mt-6 rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/[0.08] to-transparent px-4 py-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Amount to pay
          </p>
          <p className="text-4xl font-bold tabular-nums text-primary mt-1">
            {formatIDR(amount)}
          </p>
        </div>

        {/* Countdown — kartu amber besar + ikon jam */}
        <div className="mt-4 rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-500/[0.08] to-transparent px-4 py-5">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              <div className="absolute inset-0 rounded-full bg-amber-500/20 blur-xl" />
              <div className="relative h-full w-full rounded-full border border-amber-500/40 flex items-center justify-center">
                <Clock className="h-7 w-7 text-amber-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0 text-center">
              <p className="text-sm font-medium text-amber-400">
                Time left to confirm
              </p>
              <p className="text-4xl font-bold tabular-nums text-amber-400 leading-tight">
                {mm}:{ss}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                If time runs out, this order is cancelled. Your table stays open.
              </p>
            </div>
          </div>
        </div>

        {/* Waiting */}
        <div className="mt-4 rounded-xl border border-border bg-muted/20 px-4 py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Waiting for cashier confirmation…
        </div>

        {/* Cancel — outline merah */}
        <button
          type="button"
          disabled={cancelling}
          onClick={handleCancel}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 py-3.5 text-sm font-semibold text-foreground hover:bg-primary/10 transition disabled:opacity-50"
        >
          {cancelling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4 text-primary" />
          )}
          Cancel this payment
        </button>

        {/* Back to bill */}
        <button
          type="button"
          onClick={() => router.replace(backHref)}
          className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to bill
        </button>
      </div>
    </div>
  );
}
