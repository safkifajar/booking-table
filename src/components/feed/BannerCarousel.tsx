"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicBanner } from "@/lib/banner-actions";

interface Props {
  banners: PublicBanner[];
  /** Auto-play interval (ms). 0 = disabled. Default 5000. */
  autoPlayMs?: number;
}

/**
 * Carousel banner promo horizontal swipeable.
 *
 * Implementation note:
 * - Track pakai scroll-snap untuk gesture swipe native (no JS animation overhead)
 * - Auto-play set currentIndex → useEffect call scrollTo()
 * - isProgrammaticScrollRef guard: saat scrollTo lagi jalan, abaikan handleScroll
 *   untuk hindari race condition (scrollTo bertabrakan dengan scroll event)
 * - Hover/touch pause cuma di desktop; mobile cek touch melalui pointer events
 */
export function BannerCarousel({ banners, autoPlayMs = 5000 }: Props) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = React.useRef(false);
  const scrollEndTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Auto-play
  React.useEffect(() => {
    if (autoPlayMs <= 0 || paused || banners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((i) => (i + 1) % banners.length);
    }, autoPlayMs);
    return () => clearInterval(interval);
  }, [autoPlayMs, paused, banners.length]);

  // Scroll track ke current index saat berubah (programmatic)
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const child = track.children[currentIndex] as HTMLElement | undefined;
    if (!child) return;

    // Tandai bahwa scroll ini programmatic supaya handleScroll skip
    isProgrammaticScrollRef.current = true;
    track.scrollTo({ left: child.offsetLeft, behavior: "smooth" });

    // Reset flag setelah scroll animation selesai (~500ms).
    // Pakai scrollend kalau browser support, else timeout.
    if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 600);
  }, [currentIndex]);

  // Update currentIndex saat user manually swipe (sync dengan scroll position)
  function handleScroll() {
    if (isProgrammaticScrollRef.current) return;
    const track = trackRef.current;
    if (!track) return;
    const itemWidth = track.scrollWidth / banners.length;
    if (itemWidth === 0) return;
    const newIndex = Math.round(track.scrollLeft / itemWidth);
    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < banners.length) {
      setCurrentIndex(newIndex);
    }
  }

  if (banners.length === 0) return null;

  function goPrev() {
    setCurrentIndex((i) => (i - 1 + banners.length) % banners.length);
  }

  function goNext() {
    setCurrentIndex((i) => (i + 1) % banners.length);
  }

  return (
    <div
      className="relative group/carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onPointerDown={(e) => {
        // Pause saat user mulai interaksi (drag/touch). Resume saat keluar.
        if (e.pointerType === "touch") setPaused(true);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "touch") {
          // Beri jeda 3 detik sebelum resume auto-play supaya user sempat baca
          setTimeout(() => setPaused(false), 3000);
        }
      }}
    >
      {/* Track */}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none rounded-xl"
        style={{ scrollbarWidth: "none" }}
      >
        {banners.map((b) => (
          <BannerSlide key={b.id} banner={b} />
        ))}
      </div>

      {/* Prev/Next (hidden on touch, shown on hover desktop) */}
      {banners.length > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 backdrop-blur-sm items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 hover:bg-black/60 transition hidden md:flex"
            aria-label="Banner sebelumnya"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 backdrop-blur-sm items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 hover:bg-black/60 transition hidden md:flex"
            aria-label="Banner berikutnya"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Dots */}
      {banners.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {banners.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrentIndex(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === currentIndex
                  ? "w-6 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
              aria-label={`Banner ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BannerSlide({ banner }: { banner: PublicBanner }) {
  return (
    <div className="relative shrink-0 w-full snap-center aspect-[16/9] bg-zinc-900">
      <Image
        src={banner.imageUrl}
        alt={banner.title ?? "Promo"}
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, 672px"
        priority={banner.sortOrder === 0}
      />

      {/* Overlay text */}
      {(banner.title || banner.subtitle) && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-4 sm:p-5">
          {banner.title && (
            <h3 className="text-base sm:text-lg font-bold text-white mb-0.5">
              {banner.title}
            </h3>
          )}
          {banner.subtitle && (
            <p className="text-xs sm:text-sm text-white/80 line-clamp-2">
              {banner.subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
