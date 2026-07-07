"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Viewer galeri foto fullscreen — GENERAL, bisa dipakai di mana saja
 * (profil, network, story preview, dsb). Buka di `initialIndex`, bisa
 * swipe / panah kiri-kanan antar foto. Backdrop hitam, object-contain,
 * ESC/klik-tutup, counter + dot indikator.
 *
 * Contoh:
 *   const [open, setOpen] = useState<number | null>(null);
 *   ...
 *   {open !== null && (
 *     <PhotoGalleryViewer
 *       photos={photos}
 *       initialIndex={open}
 *       alt={name}
 *       onClose={() => setOpen(null)}
 *     />
 *   )}
 */
export function PhotoGalleryViewer({
  photos,
  initialIndex = 0,
  alt = "",
  onClose,
}: {
  /** Daftar URL foto. */
  photos: string[];
  /** Index foto yg dibuka pertama (default 0). */
  initialIndex?: number;
  /** Alt text dasar (di-suffix "— photo N"). */
  alt?: string;
  onClose: () => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(initialIndex);
  const count = photos.length;
  // LOOP MULUS (recenter): track selalu punya 3 slot [kiri, TENGAH, kanan].
  // Tengah = foto aktif; kiri = aktif-1 (wrap), kanan = aktif+1 (wrap). Track
  // selalu berada di posisi tengah. Setelah geser mendarat di kiri/kanan →
  // update `active` (wrap) lalu re-center diam2 (tanpa animasi). Geser terus
  // muter mulus tanpa lompatan yg keliatan. Hanya kalau > 1 foto.
  const loop = count > 1;
  const settleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mod = (n: number) => ((n % count) + count) % count;

  const slots = loop
    ? [photos[mod(active - 1)], photos[active], photos[mod(active + 1)]]
    : photos;
  const CENTER = loop ? 1 : initialIndex;

  // Center track ke slot tengah (tanpa animasi).
  const recenter = React.useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = CENTER * el.clientWidth;
  }, [CENTER]);

  // Saat mount / active berubah → center ke slot tengah.
  React.useEffect(() => {
    recenter();
  }, [active, recenter]);

  // Kunci scroll body selama viewer terbuka.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ESC tutup, panah kiri/kanan navigasi.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (count === 0) return null;

  // Debounce: setelah scroll berhenti, cek slot mana yg aktif → geser `active`.
  function onScroll() {
    if (!loop) {
      const el = scrollRef.current;
      if (el)
        setActive(
          Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth)))
        );
      return;
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const slot = Math.round(el.scrollLeft / el.clientWidth); // 0,1,2
      if (slot === CENTER) return; // masih di tengah
      // Geser ke kiri (slot 0) → foto sebelumnya; kanan (slot 2) → berikutnya.
      setActive((a) => mod(a + (slot - CENTER)));
    }, 90);
  }

  function go(delta: number) {
    const el = scrollRef.current;
    if (!el) return;
    if (!loop) {
      const next = Math.max(0, Math.min(count - 1, active + delta));
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
      return;
    }
    // Scroll ke slot tetangga → onScroll settle akan update active + recenter.
    el.scrollTo({
      left: (CENTER + delta) * el.clientWidth,
      behavior: "smooth",
    });
  }

  // Render via PORTAL ke document.body → viewer benar-benar fullscreen apa pun
  // ancestor-nya (ancestor dgn transform/filter tak lagi membatasi `fixed`).
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/95" onClick={onClose}>
      {/* Tombol tutup */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-20 rounded-full bg-black/40 p-2 text-white/80 transition hover:text-white"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Counter */}
      {count > 1 && (
        <span className="absolute left-4 top-4 z-20 rounded-full bg-black/40 px-3 py-1 text-sm font-medium text-white/90">
          {active + 1}/{count}
        </span>
      )}

      {/* Track swipe (horizontal, snap per foto) */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden no-scrollbar"
        style={{ scrollbarWidth: "none" }}
      >
        {slots.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="relative h-full w-full shrink-0 snap-center"
          >
            <Image
              src={src}
              alt={alt ? `${alt} — photo` : "Photo"}
              fill
              className="object-contain"
              unoptimized
              priority={i === CENTER}
            />
          </div>
        ))}
      </div>

      {/* Panah prev/next (desktop) — selalu tampil (loop muter). */}
      {count > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="Previous photo"
          className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 transition hover:text-white sm:block"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {count > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="Next photo"
          className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 transition hover:text-white sm:block"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Dot indikator */}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-5 z-20 flex items-center justify-center gap-1.5">
          {photos.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === active ? "w-5 bg-white" : "w-1.5 bg-white/40"
              )}
            />
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
