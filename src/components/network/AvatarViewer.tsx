"use client";

import * as React from "react";
import Image from "next/image";
import { X } from "lucide-react";

/**
 * Viewer foto profil ukuran penuh (backdrop hitam, object-contain, ESC/klik
 * untuk tutup). Pola sama dgn StoryViewer tapi cuma 1 gambar statis.
 */
export function AvatarViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/40 p-2 text-white/80 transition hover:text-white"
        aria-label="Tutup"
      >
        <X className="h-5 w-5" />
      </button>
      <div
        className="relative w-full max-w-md aspect-square"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={src}
          alt={alt}
          fill
          className="object-contain"
          unoptimized
          priority
        />
      </div>
    </div>
  );
}
