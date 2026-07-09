"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";
import { checkPaymentStatus } from "@/lib/actions";
import { toast } from "sonner";

/**
 * Dialog QRIS untuk customer/waiter: render QR asli (dari qrString Duitku) +
 * auto-poll status tiap 5 detik. Begitu lunas → panggil onPaid.
 */
export function QrisPaymentDialog({
  paymentId,
  qrString,
  amount,
  onPaid,
  onClose,
}: {
  paymentId: string;
  qrString: string;
  amount: number;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [qrImage, setQrImage] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

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
      void checkPaymentStatus(paymentId)
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
      const r = await checkPaymentStatus(paymentId);
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

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl"
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
            <div className="text-[10px] text-muted-foreground italic">
              Waiting for payment — this updates automatically once paid.
            </div>
          </div>

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
            className="w-full"
            onClick={onClose}
            disabled={checking}
          >
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
