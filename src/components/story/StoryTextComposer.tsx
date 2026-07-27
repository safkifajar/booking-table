"use client";

import * as React from "react";
import { toast } from "sonner";
import { X, Loader2, Check } from "lucide-react";
import { createTextStory } from "@/lib/story-actions";
import {
  STORY_TEXT_BG_COLORS,
  STORY_TEXT_STYLES,
  STORY_TEXT_STYLE_CLASS,
  STORY_TEXT_STYLE_LABEL,
  type StoryTextStyle,
} from "@/lib/story-constants";
import { getActionErrorMessage, cn } from "@/lib/utils";
import { useMentionAutocomplete } from "./useMentionAutocomplete";

interface Props {
  barId: string;
  onClose: () => void;
  onCreated: () => void;
}

const MAX_TEXT = 280;

/**
 * Composer story TEKS: latar warna (preset) + teks di tengah. Tanpa foto.
 * Full-screen, latar mengikuti warna terpilih supaya WYSIWYG.
 */
export function StoryTextComposer({ barId, onClose, onCreated }: Props) {
  const [text, setText] = React.useState("");
  const [bgColor, setBgColor] = React.useState<string>(STORY_TEXT_BG_COLORS[0]);
  const [textStyle, setTextStyle] = React.useState<StoryTextStyle>("classic");
  const [saving, setSaving] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const mention = useMentionAutocomplete({
    value: text,
    setValue: (v) => setText(v.slice(0, MAX_TEXT)),
    inputRef: taRef,
  });

  // Siklus gaya teks (mirip tombol "Aa" WhatsApp): classic → serif → mono → strong.
  function cycleStyle() {
    const idx = STORY_TEXT_STYLES.indexOf(textStyle);
    setTextStyle(STORY_TEXT_STYLES[(idx + 1) % STORY_TEXT_STYLES.length]);
  }

  // Fokus textarea saat buka + lock scroll body.
  React.useEffect(() => {
    taRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function handleSubmit() {
    const value = text.trim();
    if (!value) {
      toast.error("Write something first");
      return;
    }
    setSaving(true);
    try {
      await createTextStory({ barId, text: value, bgColor, textStyle });
      toast.success("Story posted");
      onCreated();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to post story"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition disabled:opacity-50"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        {/* Tombol "Aa" — ganti gaya tipografi (mirip WhatsApp). */}
        <button
          type="button"
          onClick={cycleStyle}
          aria-label="Change text style"
          className={cn(
            "h-9 min-w-9 rounded-full border border-white/40 px-3 text-base text-white transition hover:bg-white/10",
            STORY_TEXT_STYLE_CLASS[textStyle]
          )}
        >
          {STORY_TEXT_STYLE_LABEL[textStyle]}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Post"
          )}
        </button>
      </header>

      {/* Canvas — latar warna + textarea tengah (WYSIWYG dgn viewer) */}
      <div
        className="relative flex-1 mx-4 mb-3 rounded-2xl overflow-hidden flex items-center justify-center"
        style={{ backgroundColor: bgColor }}
      >
        <textarea
          ref={taRef}
          value={text}
          onChange={mention.onChange}
          onKeyUp={mention.onCaretMove}
          onClick={mention.onCaretMove}
          placeholder="Type something… use @ to mention"
          rows={4}
          className={cn(
            "w-full max-w-md resize-none bg-transparent px-8 text-center text-2xl leading-snug text-white placeholder-white/50 outline-none",
            STORY_TEXT_STYLE_CLASS[textStyle]
          )}
        />
        <span className="absolute bottom-3 right-4 text-[11px] font-medium text-white/70 tabular-nums">
          {text.length}/{MAX_TEXT}
        </span>
        {mention.dropdown}
      </div>

      {/* Palet warna preset */}
      <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-none px-4 pb-6">
        {STORY_TEXT_BG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setBgColor(c)}
            aria-label={`Background ${c}`}
            className={cn(
              "relative h-9 w-9 shrink-0 rounded-full border-2 transition",
              bgColor === c
                ? "border-white scale-110"
                : "border-white/30 hover:border-white/60"
            )}
            style={{ backgroundColor: c }}
          >
            {bgColor === c && (
              <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
