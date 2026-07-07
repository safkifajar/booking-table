"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { PhotoGalleryViewer } from "@/components/ui/photo-gallery-viewer";

/**
 * Galeri foto profil ala CMB — swipe horizontal (scroll-snap) + indikator dot +
 * counter "1/N" pojok kiri-atas. Tema gelap SOHO. Dipakai di halaman My Profile.
 *
 * `photos` = URL storage (mis. /uploads/photos/xxx.webp). foto[0] = utama.
 * Kalau kosong, tampil placeholder.
 */
export function ProfilePhotoCarousel({
  photos,
  displayName,
  fullWidth = false,
}: {
  photos: string[];
  displayName: string;
  /** true = lebar penuh + potret 4:5 (kartu Discover). default = persegi max-w-xs. */
  fullWidth?: boolean;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);
  const count = photos.length;
  // Kelas ukuran kontainer sesuai mode.
  const frameCls = fullWidth
    ? "aspect-[4/3] w-full"
    : "mx-auto aspect-square w-full max-w-xs";
  // Index foto yg sedang dibuka fullscreen (null = tertutup).
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);
  // Posisi pointer saat mulai tekan — untuk bedakan tap vs swipe.
  const downPos = React.useRef<{ x: number; y: number } | null>(null);

  function onScroll() {
    const el = scrollRef.current;
    if (!el || count === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActive(Math.max(0, Math.min(count - 1, idx)));
  }

  function goTo(i: number) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  if (count === 0) {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border bg-muted/30 flex items-center justify-center",
          frameCls
        )}
      >
        <span className="text-5xl font-bold text-muted-foreground/40">
          {displayName.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <>
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-muted/20",
        frameCls
      )}
    >
      {/* Track swipe */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto no-scrollbar"
        style={{ scrollbarWidth: "none" }}
      >
        {photos.map((src, i) => (
          <button
            key={src}
            type="button"
            aria-label={`View photo ${i + 1} full screen`}
            onPointerDown={(e) => {
              downPos.current = { x: e.clientX, y: e.clientY };
            }}
            onClick={(e) => {
              // Buka viewer hanya kalau tap (bukan geser/swipe).
              const d = downPos.current;
              if (
                d &&
                Math.abs(e.clientX - d.x) < 8 &&
                Math.abs(e.clientY - d.y) < 8
              ) {
                // Cegah klik nembus ke <Link> pembungkus kartu (kalau ada) →
                // buka viewer foto SAJA, tak ikut navigasi ke halaman detail.
                e.preventDefault();
                e.stopPropagation();
                setViewerIndex(i);
              }
            }}
            className="relative h-full w-full shrink-0 snap-center cursor-zoom-in"
          >
            <Image
              src={src}
              alt={`${displayName} — photo ${i + 1}`}
              fill
              sizes="(max-width: 640px) 100vw, 640px"
              className="object-cover"
              priority={i === 0}
            />
          </button>
        ))}
      </div>

      {/* Counter "1/N" */}
      {count > 1 && (
        <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {active + 1}/{count}
        </span>
      )}

      {/* Gradient bawah biar dot kebaca */}
      {count > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />
      )}

      {/* Dot indikator */}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
          {photos.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to photo ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === active ? "w-5 bg-white" : "w-1.5 bg-white/50"
              )}
            />
          ))}
        </div>
      )}
    </div>

      {viewerIndex !== null && (
        <PhotoGalleryViewer
          photos={photos}
          initialIndex={viewerIndex}
          alt={displayName}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
}
