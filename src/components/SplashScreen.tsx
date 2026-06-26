"use client";

import * as React from "react";

/**
 * Splash screen brand SOHO — layar marun + logo, muncul sebentar saat web
 * pertama dibuka di sesi tab ini, lalu fade-out ke konten. Pakai sessionStorage
 * supaya tak muncul lagi saat navigasi internal (cuma sekali per sesi).
 */
export function SplashScreen() {
  // Mulai dari false (SSR) → tak ada mismatch. Diaktifkan di effect kalau belum
  // pernah tampil di sesi ini.
  const [show, setShow] = React.useState(false);
  const [fading, setFading] = React.useState(false);

  React.useEffect(() => {
    if (sessionStorage.getItem("soho_splash_shown")) return;
    sessionStorage.setItem("soho_splash_shown", "1");
    // rAF: hindari setState sinkron di body effect (cascading render).
    const raf = requestAnimationFrame(() => setShow(true));
    const fadeTimer = setTimeout(() => setFading(true), 1100);
    const hideTimer = setTimeout(() => setShow(false), 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100] flex items-center justify-center bg-brand-gradient transition-opacity duration-500"
      style={{ opacity: fading ? 0 : 1, pointerEvents: "none" }}
    >
      {/* glow halus */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(240,230,210,0.12),transparent_60%)]" />
      <div className="relative flex flex-col items-center gap-3 splash-pop">
        <span
          className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-2xl font-extrabold tracking-tight shadow-2xl"
          style={{ background: "var(--brand-cream)", color: "var(--brand)" }}
        >
          SO.HO
        </span>
        <span
          className="text-[11px] uppercase tracking-[0.4em] font-medium"
          style={{ color: "rgba(240,230,210,0.75)" }}
        >
          Social House
        </span>
      </div>
    </div>
  );
}
