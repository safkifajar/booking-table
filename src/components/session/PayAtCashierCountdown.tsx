"use client";

import * as React from "react";

/**
 * Countdown "segera ke kasir" untuk DP pay-at-cashier (batas 10 menit).
 * Dipakai di kartu Booking Schedule (customer), banner Home (customer), dan
 * kartu booking dashboard kasir — satu sumber tampilan supaya konsisten.
 *
 * Menghitung sisa waktu dari `expiresAt` (ISO) di client, tick tiap detik.
 * Saat habis: memanggil `onExpire` (sekali) lalu, bila `hideOnExpire`, tidak
 * merender apa pun — server sweep (expireDpIfOverdue) yang membatalkan booking,
 * jadi UI cukup menghilang. Render-prop `children(mmss)` memberi keleluasaan
 * penuh soal bungkus/gaya di tiap tempat pakai.
 */
export function PayAtCashierCountdown({
  expiresAt,
  onExpire,
  hideOnExpire = true,
  children,
}: {
  /** ISO string batas waktu. null → tak ada batas (jangan tampilkan timer). */
  expiresAt: string | null;
  /** Dipanggil sekali saat waktu habis (mis. refresh daftar). */
  onExpire?: () => void;
  /** Saat habis, jangan render apa pun (default true). */
  hideOnExpire?: boolean;
  /** Render sisa waktu "mm:ss". */
  children: (mmss: string) => React.ReactNode;
}) {
  // Sisa detik dari expiresAt. Initializer: null saat SSR (Date.now tak boleh
  // dipakai di render server → hindari mismatch), dihitung saat mount di client.
  // Lazy initializer hanya jalan sekali → aman dari cascading render.
  const compute = React.useCallback(() => {
    if (!expiresAt) return null;
    return Math.max(
      0,
      Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)
    );
  }, [expiresAt]);
  const [left, setLeft] = React.useState<number | null>(() =>
    typeof window === "undefined" ? null : compute()
  );
  const firedExpire = React.useRef(false);

  React.useEffect(() => {
    if (!expiresAt) return;
    // Tick tiap detik. Hitung pertama juga dilakukan di interval callback
    // (bukan sinkron di body effect) supaya tak memicu cascading render.
    const t = setInterval(() => setLeft(compute()), 1000);
    return () => clearInterval(t);
  }, [expiresAt, compute]);

  React.useEffect(() => {
    if (left === 0 && !firedExpire.current) {
      firedExpire.current = true;
      onExpire?.();
    }
  }, [left, onExpire]);

  if (!expiresAt) return null;
  if (left === null) return null; // belum ter-hitung (render pertama)
  if (left <= 0 && hideOnExpire) return null;

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return <>{children(`${mm}:${ss}`)}</>;
}
