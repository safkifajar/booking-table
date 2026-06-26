"use client";

import * as React from "react";

/**
 * Splash screen brand SOHO — layar marun + logo, menutupi layar SEJAK paint
 * pertama (di-render default, bukan setelah effect) supaya konten tak sempat
 * "ngeflash" di koneksi lambat. JS lalu fade-out & melepasnya.
 *
 * sessionStorage: kalau sudah pernah tampil di sesi tab ini (mis. navigasi
 * antar halaman), splash langsung dilepas tanpa animasi.
 */
export function SplashScreen() {
  const [phase, setPhase] = React.useState<"visible" | "fading" | "gone">(
    "visible"
  );

  React.useEffect(() => {
    // Sudah pernah tampil di sesi ini → lepas segera (tanpa nahan konten).
    if (sessionStorage.getItem("soho_splash_shown")) {
      const raf = requestAnimationFrame(() => setPhase("gone"));
      return () => cancelAnimationFrame(raf);
    }
    sessionStorage.setItem("soho_splash_shown", "1");
    const fadeTimer = setTimeout(() => setPhase("fading"), 1100);
    const goneTimer = setTimeout(() => setPhase("gone"), 1600);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(goneTimer);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100] flex items-center justify-center bg-brand-gradient transition-opacity duration-500"
      style={{ opacity: phase === "fading" ? 0 : 1, pointerEvents: "none" }}
    >
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
