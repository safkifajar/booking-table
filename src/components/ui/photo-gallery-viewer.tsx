"use client";

import * as React from "react";
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
  // LOOP: track punya clone di kedua ujung → [last, ...photos, first]. Slide 0
  // = clone foto terakhir, slide count+1 = clone foto pertama. Saat scroll
  // mendarat di clone, langsung lompat (tanpa animasi) ke slide asli yg sama →
  // kesan geser MUTER tanpa henti. Hanya kalau > 1 foto.
  const loop = count > 1;
  const slides = loop ? [photos[count - 1], ...photos, photos[0]] : photos;
  // Offset slide asli pertama di track (1 kalau ada clone di depan).
  const OFF = loop ? 1 : 0;
  const jumping = React.useRef(false);

  // Scroll ke foto awal saat mount (tanpa animasi). +OFF utk lewati clone depan.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = (initialIndex + OFF) * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kunci scroll body selama viewer terbuka — konten di belakang tak ikut scroll.
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

  function onScroll() {
    const el = scrollRef.current;
    if (!el || jumping.current) return;
    const raw = Math.round(el.scrollLeft / el.clientWidth); // index di `slides`
    // Mendarat di clone → lompat ke slide asli padanannya (tanpa animasi).
    if (loop && raw === 0) {
      jumping.current = true;
      el.scrollLeft = count * el.clientWidth; // foto terakhir (asli)
      jumping.current = false;
      setActive(count - 1);
      return;
    }
    if (loop && raw === count + 1) {
      jumping.current = true;
      el.scrollLeft = 1 * el.clientWidth; // foto pertama (asli)
      jumping.current = false;
      setActive(0);
      return;
    }
    setActive(Math.max(0, Math.min(count - 1, raw - OFF)));
  }

  function go(delta: number) {
    const el = scrollRef.current;
    if (!el) return;
    // Geser relatif dari posisi track sekarang → clone menangani wrap.
    const cur = Math.round(el.scrollLeft / el.clientWidth);
    el.scrollTo({ left: (cur + delta) * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95" onClick={onClose}>
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
        {slides.map((src, i) => (
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
              priority={i === initialIndex + OFF}
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
    </div>
  );
}
