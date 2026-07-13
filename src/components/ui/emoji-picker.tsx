"use client";

import * as React from "react";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Emoji picker ringan (tanpa dependency) — tombol di kanan input yg membuka
 * grid emoji populer per kategori. Klik emoji → onPick(emoji). Reusable.
 *
 * Bukan picker lengkap semua-emoji; kurasi emoji yg relevan (interests SOHO:
 * makanan/minuman, musik, hiburan, olahraga, dll) supaya ringan.
 */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Food & Drink",
    emojis: [
      "🍸", "🍷", "🍺", "🥃", "🍹", "🥂", "☕", "🍵", "🧋", "🥤",
      "🍽️", "🍔", "🍕", "🌮", "🍣", "🍜", "🍖", "🍗", "🥩", "🍰",
      "🍫", "🍩", "🍦", "🌱", "💨",
    ],
  },
  {
    label: "Music",
    emojis: ["🎵", "🎶", "🎤", "🎧", "🎷", "🎸", "🎹", "🥁", "🎺", "🎻", "💿", "📻", "🎛️", "🎚️"],
  },
  {
    label: "Going Out",
    emojis: ["🎉", "🪩", "🎟️", "🎙️", "🎭", "🎬", "🎪", "🎯", "🎳", "🃏", "♟️", "🎮", "📺", "🧠"],
  },
  {
    label: "Sports",
    emojis: ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏓", "🏸", "🥊", "🥋", "🏊", "🏃", "🚴", "🧗", "🧘", "💪", "⛳", "🎣"],
  },
  {
    label: "Creative / Life",
    emojis: [
      "📷", "🎨", "👗", "✨", "🌸", "📚", "💃", "🖌️", "⚓", "✏️",
      "✈️", "🏙️", "🏖️", "🛣️", "🤝", "👋", "🚀", "🌿", "🐾", "💗",
      "🔥", "⭐", "🌙", "❤️", "😎", "🎲",
    ],
  },
];

export function EmojiPicker({
  onPick,
  className,
}: {
  onPick: (emoji: string) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Pick emoji"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Smile className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-2 shadow-2xl">
          {EMOJI_GROUPS.map((g) => (
            <div key={g.label} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {g.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onPick(e);
                      setOpen(false);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded text-lg transition hover:bg-muted"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
