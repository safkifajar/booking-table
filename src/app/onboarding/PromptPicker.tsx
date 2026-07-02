"use client";

import * as React from "react";
import { X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pemilih prompt ice-breaker onboarding. User pilih prompt dari daftar lalu isi
 * jawaban (sheet). Maks `max`. Prompt yg sudah dijawab tampil sbg kartu; sisanya
 * bisa dipilih dari daftar.
 */
export function PromptPicker({
  prompts,
  onChange,
  options,
  max = 5,
}: {
  prompts: { prompt: string; answer: string }[];
  onChange: (next: { prompt: string; answer: string }[]) => void;
  options: string[];
  max?: number;
}) {
  // Sheet: sedang mengisi jawaban untuk prompt tertentu (index di prompts, atau
  // -1 = prompt baru dari `pending`).
  const [editing, setEditing] = React.useState<{
    prompt: string;
    answer: string;
    index: number; // -1 = baru
  } | null>(null);
  const answerMap = new Map(prompts.map((p) => [p.prompt, p.answer]));
  const atMax = prompts.length >= max;

  function saveAnswer() {
    if (!editing) return;
    const answer = editing.answer.trim();
    if (!answer) {
      // kosong → hapus kalau existing, batal kalau baru
      if (editing.index >= 0) {
        onChange(prompts.filter((_, i) => i !== editing.index));
      }
      setEditing(null);
      return;
    }
    if (editing.index >= 0) {
      onChange(
        prompts.map((p, i) =>
          i === editing.index ? { prompt: editing.prompt, answer } : p
        )
      );
    } else {
      onChange([...prompts, { prompt: editing.prompt, answer }].slice(0, max));
    }
    setEditing(null);
  }

  return (
    <div>
      {/* Semua prompt tampil langsung (CMB-style). Yg sudah dijawab tampil
          jawabannya + tombol hapus; klik prompt → isi/ubah jawaban. */}
      {options.map((o) => {
        const answer = answerMap.get(o);
        const answered = answer !== undefined;
        const index = answered
          ? prompts.findIndex((p) => p.prompt === o)
          : -1;
        const disabled = !answered && atMax;
        return (
          <div
            key={o}
            className="flex items-center gap-2 border-b border-border"
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                setEditing({ prompt: o, answer: answer ?? "", index })
              }
              className={cn(
                "flex-1 min-w-0 text-left py-5 transition",
                disabled
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:text-foreground"
              )}
            >
              <p className="text-base text-muted-foreground">{o}</p>
              {answered && (
                <p className="text-sm text-primary mt-1.5 break-words">
                  {answer}
                </p>
              )}
            </button>
            {answered ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() =>
                  onChange(prompts.filter((_, idx) => idx !== index))
                }
                className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </div>
        );
      })}

      {atMax && (
        <p className="text-[11px] text-muted-foreground pt-3">
          You&apos;ve added the max of {max} prompts.
        </p>
      )}

      {/* Isi jawaban (sheet) */}
      {editing && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold mb-2">{editing.prompt}</p>
            <textarea
              autoFocus
              value={editing.answer}
              onChange={(e) =>
                setEditing((s) => (s ? { ...s, answer: e.target.value } : s))
              }
              maxLength={280}
              rows={3}
              placeholder="Type your answer…"
              className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary/60 transition resize-none"
            />
            <div className="mt-1 text-right text-[11px] text-muted-foreground">
              {editing.answer.length}/280
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 h-11 rounded-full border border-border text-sm font-medium hover:bg-muted/60 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!editing.answer.trim()}
                onClick={saveAnswer}
                className={cn(
                  "flex-1 h-11 rounded-full text-sm font-semibold transition",
                  "bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-50"
                )}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
