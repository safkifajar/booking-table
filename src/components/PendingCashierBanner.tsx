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
          // Gaya solid-fill mengikuti MembershipBanner (blok gradasi + ikon
          // kotak rounded kiri + pill CTA kontras kanan), TAPI warna amber —
          // beda dari banner membership (gold/primary). Teks amber-950 utk
          // kontras di atas isian terang.
          <Link
            href={`/booking/${b.session_id}/pay`}
            className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-amber-500 to-amber-400/80 p-3.5 shadow-lg shadow-amber-500/20 transition hover:shadow-amber-500/35 group"
          >
            {/* Aksen dekoratif lembut di pojok kiri-atas. */}
            <div className="pointer-events-none absolute -left-8 -top-12 h-24 w-24 rounded-full bg-white/15" />

            <div className="h-10 w-10 rounded-xl bg-black/20 flex items-center justify-center shrink-0">
              <Banknote className="h-5 w-5 text-amber-950" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-950 truncate">
                Pay at the cashier — table {b.table_label}
              </p>
              <p className="text-xs text-amber-950/70 truncate">
                DP {formatIDR(b.amount)} · pay to confirm your booking
              </p>
            </div>
            {/* Countdown = pill CTA kontras (putih) di kanan, seperti banner
                membership — sekaligus menandai urgensi (sisa waktu). */}
            <span className="relative z-10 shrink-0 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-amber-700 shadow tabular-nums group-hover:scale-105 transition">
              {mmss}
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        )}
      </PayAtCashierCountdown>
    </div>
  );
}
