"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, CheckCircle2, X, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";
import { checkPaymentStatus, cancelPayment } from "@/lib/actions";
import { toast } from "sonner";
import { buildQrisFramePng } from "@/lib/qris-frame";

/**
 * Dialog QRIS untuk customer/waiter: render QR asli (dari qrString Duitku) +
 * auto-poll status tiap 5 detik. Begitu lunas → panggil onPaid.
 */
export function QrisPaymentDialog({
  paymentId,
  qrString,
  amount,
  expirySeconds,
  onPaid,
  onExpired,
  onCancelled,
  onClose,
  checkAction,
  cancelAction,
}: {
  paymentId: string;
  qrString: string;
  amount: number;
  /** Batas waktu bayar (detik). Tampilkan countdown; habis → onExpired. */
  expirySeconds?: number;
  onPaid: () => void;
  /** Dipanggil saat countdown habis (mis. DP booking → booking dibatalkan). */
  onExpired?: () => void;
  /** Dipanggil saat user menekan "Batalkan transaksi" & berhasil dibatalkan. */
  onCancelled?: () => void;
  onClose: () => void;
  /**
   * Action poll/batal yang bisa DIGANTI — default pembayaran order
   * (checkPaymentStatus/cancelPayment). Membership menyuntikkan action-nya
   * sendiri; dialog & UX-nya identik.
   */
  checkAction?: (id: string) => Promise<{ status: string }>;
  cancelAction?: (id: string) => Promise<{ status: string }>;
}) {
  const check = checkAction ?? checkPaymentStatus;
  const cancel = cancelAction ?? cancelPayment;
  const [qrImage, setQrImage] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  // Konfirmasi batalkan inline (bukan useConfirm) supaya tak bentrok z-index
  // dgn portal dialog ini (dialog di z-[100], Radix confirm di z-50 → ketutup).
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(expirySeconds ?? 0);

  // Generate gambar QR dari qrString (EMV QRIS asli).
  React.useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QR) => {
      QR.toDataURL(qrString, { width: 320, margin: 1 })
        .then((url: string) => {
          if (!cancelled) setQrImage(url);
        })
        .catch(() => {
          if (!cancelled) setQrImage(null);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [qrString]);

  // Auto-poll status tiap 5 detik.
  React.useEffect(() => {
    const t = setInterval(() => {
      void check(paymentId)
        .then((r) => {
          if (r.status === "paid") {
            toast.success("Payment received");
            onPaid();
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  // Countdown (kalau ada batas waktu). Habis → onExpired.
  React.useEffect(() => {
    if (!expirySeconds || expirySeconds <= 0) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          // Cek sekali lagi kalau-kalau baru saja lunas; kalau belum → batalkan
          // transaksi (server set payment failed + booking cancelled) supaya
          // meja bebas lagi walau host tak balik ke denah.
          void check(paymentId)
            .then(async (r) => {
              if (r.status === "paid") {
                onPaid();
                return;
              }
              try {
                await cancel(paymentId);
              } catch {
                // best-effort; sweep denah tetap jadi jaring pengaman.
              }
              toast.error("Payment time is up — booking cancelled");
              onExpired?.();
            })
            .catch(() => {
              onExpired?.();
            });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expirySeconds, paymentId]);

  // Kunci scroll background.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function handleCheck() {
    setChecking(true);
    try {
      const r = await check(paymentId);
      if (r.status === "paid") {
        toast.success("Payment received");
        onPaid();
      } else {
        toast.info("Not paid yet — please complete the scan");
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to check status"));
    } finally {
      setChecking(false);
    }
  }

  // Unduh QR ber-frame branded SOHO (logo + nama + nominal) sebagai PNG.
  async function handleDownload() {
    if (!qrImage) return;
    try {
      const png = await buildQrisFramePng({
        qrDataUrl: qrImage,
        amountLabel: formatIDR(amount),
        transactionId: paymentId,
      });
      const a = document.createElement("a");
      a.href = png;
      a.download = `qris-soho-${paymentId}.png`;
      a.click();
    } catch {
      // Fallback: QR polos kalau frame gagal digenerate.
      const a = document.createElement("a");
      a.href = qrImage;
      a.download = `qris-${paymentId}.png`;
      a.click();
    }
  }

  // Batalkan transaksi (setelah konfirmasi inline). DP booking → booking batal.
  async function handleCancel() {
    setCancelling(true);
    try {
      await cancel(paymentId);
      toast.success("Transaction cancelled");
      onCancelled?.();
      onClose();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel transaction"));
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-sm bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Pay with QRIS</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="rounded-md border border-primary/30 bg-primary/[0.03] p-4 text-center space-y-3">
            <div className="text-xs text-muted-foreground">
              Scan with any QRIS-supported app (GoPay, OVO, DANA, m-banking…)
            </div>
            <div className="aspect-square max-w-[240px] mx-auto bg-white rounded-md p-3 flex items-center justify-center">
              {qrImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImage}
                  alt="QRIS payment code"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="text-zinc-500 flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="text-[10px]">Generating QR…</span>
                </div>
              )}
            </div>
            <div className="text-2xl font-bold tabular-nums text-primary">
              {formatIDR(amount)}
            </div>
            {/* ID transaksi — untuk referensi & cek status di dashboard. */}
            <div className="text-[10px] text-muted-foreground">
              Transaction ID:{" "}
              <span className="font-mono select-all">{paymentId}</span>
            </div>
            {expirySeconds && expirySeconds > 0 ? (
              <div className="text-xs font-medium">
                Pay within{" "}
                <span
                  className={
                    secondsLeft <= 15
                      ? "text-red-400 tabular-nums"
                      : "text-primary tabular-nums"
                  }
                >
                  {Math.floor(secondsLeft / 60)}:
                  {String(secondsLeft % 60).padStart(2, "0")}
                </span>{" "}
                or the booking is cancelled.
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground italic">
                Waiting for payment — this updates automatically once paid.
              </div>
            )}
          </div>

          {/* Download QR (PNG) — untuk cetak / kirim ke customer. */}
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={handleDownload}
            disabled={!qrImage}
          >
            <Download className="h-4 w-4" /> Download QR
          </Button>
          <Button
            variant="gold"
            size="lg"
            className="w-full"
            onClick={handleCheck}
            disabled={checking}
          >
            {checking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> I&apos;ve paid — check status
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-red-400 hover:text-red-300"
            onClick={() => setConfirmingCancel(true)}
            disabled={checking || cancelling}
          >
            Cancel transaction
          </Button>
        </div>

        {/* Konfirmasi batalkan — inline di dalam portal yg sama (bukan
            useConfirm) supaya selalu di atas dialog, tak ketutup z-index.
            Gaya disamakan dgn ConfirmDialog global: icon badge + title +
            description, footer outline "Keep" + destructive "Cancel". */}
        {confirmingCancel && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-5"
            onClick={() => !cancelling && setConfirmingCancel(false)}
          >
            <div
              className="w-full max-w-[420px] rounded-lg border border-border bg-background p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full border bg-red-500/15 text-red-400 border-red-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold leading-none tracking-tight">
                    Cancel this transaction?
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The QRIS code will be voided. If this is a booking down
                    payment, the booking will also be cancelled.
                  </p>
                </div>
              </div>
              <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button
                  variant="outline"
                  className="sm:min-w-[100px]"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={cancelling}
                >
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  className="sm:min-w-[100px]"
                  onClick={handleCancel}
                  disabled={cancelling}
                  autoFocus
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Cancelling…
                    </>
                  ) : (
                    "Cancel transaction"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
