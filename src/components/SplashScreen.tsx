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
      className="fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-500"
      style={{
        background: "#8d1312",
        opacity: phase === "fading" ? 0 : 1,
        pointerEvents: "none",
      }}
    >
      {/* Latar solid #8d1312 (tanpa gradasi) = persis bg JPEG → kotak logo
          tak terlihat, menyatu sempurna. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-soho.jpeg"
        alt="SOHO Social House"
        className="relative w-56 sm:w-64 h-auto splash-pop select-none"
      />
    </div>
  );
}
