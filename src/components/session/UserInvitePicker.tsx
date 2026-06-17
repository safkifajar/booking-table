"use client";

import * as React from "react";
import { Search, Plus, X, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import {
  searchInviteCandidates,
  type InviteCandidate,
} from "@/lib/customer-actions";

/**
 * Picker user (search + multi-select chip) untuk mengajak/mengundang ke meja.
 * Dipakai di OpenTableForm (saat buka meja) & SessionView (ajak dari meja
 * berjalan). mode "join" = friends (langsung gabung), "invite" = perlu diterima.
 */
export function UserInvitePicker({
  mode,
  selected,
  onChange,
  excludeSessionId,
}: {
  mode: "join" | "invite";
  selected: InviteCandidate[];
  onChange: (next: InviteCandidate[]) => void;
  /** Saat dari session: sembunyikan user yg sudah jadi member meja itu. */
  excludeSessionId?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<InviteCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 1) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchInviteCandidates(q, excludeSessionId);
        // Sembunyikan yg sudah terpilih.
        const selIds = new Set(selected.map((s) => s.id));
        setResults(rows.filter((r) => !selIds.has(r.id)));
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function add(u: InviteCandidate) {
    onChange([...selected, u]);
    setResults((prev) => prev.filter((r) => r.id !== u.id));
    setQuery("");
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        {mode === "join" ? "Ajak teman" : "Undang user"}{" "}
        <span className="text-muted-foreground font-normal">
          {mode === "join" ? "(langsung gabung)" : "(perlu mereka terima)"}
        </span>
      </label>

      {/* Chip user terpilih */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-primary/15 border border-primary/30 text-xs"
            >
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[9px]">
                  {initials(u.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-primary">{u.name}</span>
              <button
                type="button"
                onClick={() => remove(u.id)}
                aria-label="Hapus"
                className="text-primary/60 hover:text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Cari nama atau email…"
          className="w-full h-11 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </div>

      {/* Hasil search */}
      {query.trim().length > 0 && (
        <div className="mt-1.5 rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
          {searching ? (
            <div className="p-3 text-center">
              <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="p-3 text-center text-xs text-muted-foreground">
              Tidak ada user cocok.
            </p>
          ) : (
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => add(u)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 transition"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-[10px]">
                    {initials(u.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {u.email}
                  </p>
                </div>
                <Plus className="h-4 w-4 text-primary shrink-0" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
