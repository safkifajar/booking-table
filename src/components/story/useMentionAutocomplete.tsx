"use client";

import * as React from "react";
import {
  getMentionableFriends,
  type MentionCandidate,
} from "@/lib/story-actions";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

/**
 * Autocomplete @mention untuk input teks story/caption.
 *
 * Cara pakai:
 *   const m = useMentionAutocomplete({ value, setValue, inputRef });
 *   <textarea ... onChange={m.onChange} onKeyUp={m.onCaretMove} onClick={m.onCaretMove} />
 *   {m.dropdown}
 *
 * Mendeteksi token "@handle" di posisi caret, memuat daftar teman (sekali),
 * memfilter, dan menyisipkan "@username " saat dipilih.
 */
export function useMentionAutocomplete({
  value,
  setValue,
  inputRef,
}: {
  value: string;
  setValue: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [friends, setFriends] = React.useState<MentionCandidate[]>([]);
  const [query, setQuery] = React.useState<string | null>(null); // null = tak aktif
  const tokenStartRef = React.useRef<number>(-1);

  // Muat daftar teman sekali (best-effort).
  React.useEffect(() => {
    let alive = true;
    getMentionableFriends()
      .then((list) => alive && setFriends(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Deteksi token @… tepat sebelum caret.
  const detect = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    // Cari '@' terakhir yang diikuti hanya [a-z0-9_] sampai caret, dan didahului
    // batas kata (awal / spasi / newline).
    const match = /(^|\s)@([a-z0-9_]{0,20})$/i.exec(upto);
    if (match) {
      tokenStartRef.current = caret - match[2].length - 1; // posisi '@'
      setQuery(match[2].toLowerCase());
    } else {
      tokenStartRef.current = -1;
      setQuery(null);
    }
  }, [value, inputRef]);

  const onChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      // detect dijalankan setelah value ter-set via effect di bawah.
    },
    [setValue]
  );

  // Re-detect tiap value berubah.
  React.useEffect(() => {
    detect();
  }, [value, detect]);

  const onCaretMove = React.useCallback(() => detect(), [detect]);

  function pick(c: MentionCandidate) {
    const el = inputRef.current;
    const start = tokenStartRef.current;
    if (!el || start < 0) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(caret);
    const insert = `@${c.username} `;
    const next = before + insert + after;
    setValue(next);
    setQuery(null);
    tokenStartRef.current = -1;
    // Kembalikan fokus + set caret setelah sisipan.
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + insert).length;
      el.setSelectionRange(pos, pos);
    });
  }

  const results =
    query === null
      ? []
      : friends
          .filter(
            (f) =>
              f.username.toLowerCase().includes(query) ||
              f.displayName.toLowerCase().includes(query)
          )
          .slice(0, 6);

  const dropdown =
    query !== null && results.length > 0 ? (
      <div className="fixed inset-x-4 bottom-24 z-[60] mx-auto max-w-md max-h-56 overflow-y-auto rounded-xl border border-white/15 bg-black/90 backdrop-blur-md shadow-2xl">
        {results.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => pick(f)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/10"
          >
            <Avatar className="h-8 w-8 shrink-0">
              {f.avatarUrl && <AvatarImage src={f.avatarUrl} alt={f.displayName} />}
              <AvatarFallback className="text-[10px]">
                {initials(f.displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">
                {f.displayName}
              </div>
              <div className="truncate text-xs text-white/60">
                @{f.username}
              </div>
            </div>
          </button>
        ))}
      </div>
    ) : null;

  return { onChange, onCaretMove, dropdown, active: query !== null };
}
