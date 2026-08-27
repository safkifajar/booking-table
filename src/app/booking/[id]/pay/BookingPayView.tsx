"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Banknote, Loader2, X } from "lucide-react";
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
  reference,
  qrString,
  amount,
  secondsLeft,
  sessionId,
  barSlug,
  mode = "qris",
  tableLabel,
}: {
  paymentId: string;
  /** Reference gateway (Duitku) — ditampilkan menggantikan id kita bila ada. */
  reference?: string | null;
  qrString: string | null;
  amount: number;
  secondsLeft: number;
  sessionId: string;
  barSlug: string;
  mode?: "qris" | "cashier" | "unavailable";
  tableLabel?: string;
}) {
  const router = useRouter();

  // Gateway gagal membuat QRIS. Sebelumnya halaman ini mengalihkan ke
  // /session/[id], padahal penjaga di sana melempar balik ke sini selama DP
  // belum lunas — tamu terjebak bolak-balik & layarnya hitam.
  if (mode === "unavailable") {
    return (
      <QrisUnavailableView
        paymentId={paymentId}
        amount={amount}
        sessionId={sessionId}
        barSlug={barSlug}
        tableLabel={tableLabel}
      />
    );
  }

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
        reference={reference}
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
      toast.error("Booking cancelled. Cashier confirmation time ran out");
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

/**
 * QRIS tak bisa dibuat (gateway sedang bermasalah / belum aktif).
 *
 * Menampilkan penjelasan & jalan keluar, BUKAN mengalihkan: halaman detail
 * sesi menolak host selama DP belum lunas, jadi pengalihan ke sana membuat
 * tamu terlempar bolak-balik tanpa henti.
 *
 * Dua jalan keluar diberikan — bayar di kasir (mejanya tetap dipesan), atau
 * batalkan booking supaya mejanya tak terkunci menunggu pembayaran yang tak
 * mungkin diselesaikan.
 */
function QrisUnavailableView({
  paymentId,
  amount,
  sessionId,
  barSlug,
  tableLabel,
}: {
  paymentId: string;
  amount: number;
  sessionId: string;
  barSlug: string;
  tableLabel?: string;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = React.useState(false);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await cancelPayment(paymentId);
      // Bisa saja callback gateway masuk tepat saat ini — kalau ternyata
      // sudah lunas, jangan batalkan, antar ke mejanya.
      if (res.status === "paid") {
        router.replace(`/session/${sessionId}`);
        return;
      }
      router.replace(`/bar/${barSlug}`);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Couldn't cancel the booking"));
      setCancelling(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm p-6 text-center space-y-5">
        <div className="space-y-3">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">QRIS is unavailable</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              We couldn&apos;t generate a QRIS code for this payment right now.
              Your table{tableLabel ? ` ${tableLabel}` : ""} is still reserved —
              you can pay at the cashier instead.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Down payment
          </p>
          <p className="mt-0.5 text-xl font-semibold">{formatIDR(amount)}</p>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => router.replace(`/bar/${barSlug}`)}
          >
            <Banknote className="h-4 w-4" />
            I&apos;ll pay at the cashier
          </Button>
          <Button
            variant="ghost"
            className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Cancel booking
          </Button>
        </div>
      </Card>
    </div>
  );
}
