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

  // Scroll ke foto awal saat mount (tanpa animasi).
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = initialIndex * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!el) return;
    setActive(
      Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth)))
    );
  }

  function go(delta: number) {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(count - 1, active + delta));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
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
        {photos.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="relative h-full w-full shrink-0 snap-center"
          >
            <Image
              src={src}
              alt={alt ? `${alt} — photo ${i + 1}` : `Photo ${i + 1}`}
              fill
              className="object-contain"
              unoptimized
              priority={i === initialIndex}
            />
          </div>
        ))}
      </div>

      {/* Panah prev/next (desktop) */}
      {count > 1 && active > 0 && (
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
      {count > 1 && active < count - 1 && (
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
