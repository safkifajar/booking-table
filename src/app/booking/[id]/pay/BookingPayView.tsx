"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2, X } from "lucide-react";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cancelPayment } from "@/lib/actions";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Halaman lanjut bayar DP booking.
 * - mode "qris": bungkus QrisPaymentDialog full-screen (QR + countdown 1 mnt).
 * - mode "cashier" (Pay at cashier): instruksi konfirmasi ke kasir + countdown
 *   10 menit + poll refresh — kasir konfirmasi → server redirect ke session;
 *   waktu habis → booking dibatalkan, balik ke denah.
 */
export function BookingPayView({
  paymentId,
  qrString,
  amount,
  secondsLeft,
  sessionId,
  barSlug,
  mode = "qris",
  tableLabel,
}: {
  paymentId: string;
  qrString: string | null;
  amount: number;
  secondsLeft: number;
  sessionId: string;
  barSlug: string;
  mode?: "qris" | "cashier";
  tableLabel?: string;
}) {
  const router = useRouter();

  if (mode === "cashier") {
    return (
      <CashierWaitView
        paymentId={paymentId}
        amount={amount}
        secondsLeft={secondsLeft}
        sessionId={sessionId}
        barSlug={barSlug}
        tableLabel={tableLabel}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <QrisPaymentDialog
        paymentId={paymentId}
        qrString={qrString ?? ""}
        amount={amount}
        // Kalau sudah lewat (secondsLeft 0), tetap kasih 1 dtk supaya effect
        // countdown langsung memicu cancel + redirect.
        expirySeconds={Math.max(1, secondsLeft)}
        onPaid={() => router.replace(`/session/${sessionId}`)}
        onExpired={() => router.replace(`/bar/${barSlug}`)}
        onCancelled={() => router.replace(`/bar/${barSlug}`)}
        onClose={() => router.replace(`/bar/${barSlug}`)}
      />
    </div>
  );
}

function CashierWaitView({
  paymentId,
  amount,
  secondsLeft,
  sessionId,
  barSlug,
  tableLabel,
}: {
  paymentId: string;
  amount: number;
  secondsLeft: number;
  sessionId: string;
  barSlug: string;
  tableLabel?: string;
}) {
  const router = useRouter();
  const [left, setLeft] = React.useState(secondsLeft);
  const [cancelling, setCancelling] = React.useState(false);
  const expiredHandled = React.useRef(false);

  // Countdown lokal (server tetap otoritatif via expireDpIfOverdue).
  React.useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll: refresh halaman tiap 5 dtk — saat kasir konfirmasi, server redirect
  // ke /session/[id]; saat booking batal, server redirect ke denah.
  React.useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);

  // Tombol kembali (HP/browser) → arahkan ke DENAH booking, bukan history.back()
  // (yang bisa mendarat balik di form/step sebelumnya). Booking TIDAK dibatalkan
  // di sini — server sweep (expireDpIfOverdue) membebaskan meja saat timeout.
  // Dorong satu entri history dulu supaya event popstate pertama tertangkap.
  React.useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPop = () => router.replace(`/bar/${barSlug}`);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router, barSlug]);

  // Waktu habis → batalkan (idempoten; kalau ternyata sudah paid → ke session).
  React.useEffect(() => {
    if (left > 0 || expiredHandled.current) return;
    expiredHandled.current = true;
    void (async () => {
      try {
        const res = await cancelPayment(paymentId);
        if (res.status === "paid") {
          router.replace(`/session/${sessionId}`);
          return;
        }
      } catch {
        // Server sweep (expireDpIfOverdue) tetap membereskan — lanjut redirect.
      }
      toast.error("Booking cancelled — cashier confirmation time ran out");
      router.replace(`/bar/${barSlug}`);
    })();
  }, [left, paymentId, sessionId, barSlug, router]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await cancelPayment(paymentId);
      if (res.status === "paid") {
        router.replace(`/session/${sessionId}`);
        return;
      }
      toast.success("Booking cancelled");
      router.replace(`/bar/${barSlug}`);
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
                , mention table <span className="font-semibold text-foreground">{tableLabel}</span>,
              </>
            ) : ""}{" "}
            and pay the deposit to confirm your booking.
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Deposit to pay
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
            If time runs out, the booking is cancelled and the slot reopens.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for cashier confirmation…
        </div>

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
          Cancel booking
        </Button>
      </Card>
    </div>
  );
}
