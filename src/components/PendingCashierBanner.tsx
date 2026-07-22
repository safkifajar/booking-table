"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, ChevronRight } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { PayAtCashierCountdown } from "@/components/session/PayAtCashierCountdown";
import type { PendingCashierBooking } from "@/lib/queries";

/**
 * Banner home "segera ke kasir" — booking milik user yang DP-nya menunggu
 * konfirmasi kasir, dengan countdown. Klik → layar "Pay at the cashier"
 * (/booking/[id]/pay) yang menampilkan instruksi + countdown besar.
 *
 * Client Component (butuh tick countdown). Menampilkan booking pending TERBARU
 * (biasanya hanya satu). Saat semua sudah lewat batas → tak render apa pun
 * (server sweep membatalkan; refresh menghapus data).
 */
export function PendingCashierBanner({
  bookings,
}: {
  bookings: PendingCashierBooking[];
}) {
  const router = useRouter();
  // Hanya yang punya expiresAt (ada batas waktu tampil). Ambil yang paling
  // dekat kedaluwarsa supaya countdown yang tampil paling mendesak.
  const withExpiry = bookings
    .filter((b) => b.expires_at)
    .sort((a, b) =>
      (a.expires_at ?? "").localeCompare(b.expires_at ?? "")
    );
  const b = withExpiry[0];
  if (!b) return null;

  return (
    <div className="mx-4 sm:mx-6 mt-3">
      <PayAtCashierCountdown
        expiresAt={b.expires_at}
        onExpire={() => router.refresh()}
      >
        {(mmss) => (
          <Link
            href={`/booking/${b.session_id}/pay`}
            className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-3 transition hover:bg-amber-500/[0.12]"
          >
            <span className="h-9 w-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400">
              <Banknote className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-300">
                Pay at the cashier — table {b.table_label}
              </p>
              <p className="text-xs text-muted-foreground">
                DP {formatIDR(b.amount)} · pay to confirm your booking
              </p>
            </div>
            <span className="shrink-0 tabular-nums font-semibold text-amber-400 rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-1 text-sm">
              {mmss}
            </span>
            <ChevronRight className="h-4 w-4 text-amber-400/70 shrink-0" />
          </Link>
        )}
      </PayAtCashierCountdown>
    </div>
  );
}
