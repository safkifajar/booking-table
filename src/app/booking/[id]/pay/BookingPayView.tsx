"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";

/**
 * Halaman lanjut bayar DP booking. Membungkus QrisPaymentDialog full-screen:
 * - Lunas → masuk ke /session/[id].
 * - Waktu habis / dibatalkan → balik ke denah bar (booking sudah dibatalkan).
 */
export function BookingPayView({
  paymentId,
  qrString,
  amount,
  secondsLeft,
  sessionId,
  barSlug,
}: {
  paymentId: string;
  qrString: string;
  amount: number;
  secondsLeft: number;
  sessionId: string;
  barSlug: string;
}) {
  const router = useRouter();

  return (
    <div className="min-h-dvh bg-background">
      <QrisPaymentDialog
        paymentId={paymentId}
        qrString={qrString}
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
