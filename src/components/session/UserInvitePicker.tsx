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
 * Picker user (search + multi-select chip) untuk mengundang ke meja. Dipakai di
 * OpenTableForm (saat buka meja) & SessionView (undang dari meja berjalan).
 *
 * SEMUA undangan perlu persetujuan yg diundang — tak ada auto-join. Kandidat
 * mengikuti VISIBILITY meja (PRD Friends K2/K3): meja "friends" hanya boleh
 * mengundang teman; public & invite_only boleh siapa saja. Hasil muncul setelah
 * mengetik (tak pernah dump daftar).
 */
export function UserInvitePicker({
  visibility,
  selected,
  onChange,
  excludeSessionId,
}: {
  visibility: "public" | "friends" | "invite_only";
  selected: InviteCandidate[];
  onChange: (next: InviteCandidate[]) => void;
  /** Saat dari session: sembunyikan user yg sudah jadi member meja itu. */
  excludeSessionId?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<InviteCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const friendsOnly = visibility === "friends";

  const fetchCandidates = React.useCallback(
    async (q: string) => {
      setSearching(true);
      try {
        const rows = await searchInviteCandidates(q, excludeSessionId, {
          friendsOnly,
        });
        setResults(rows);
      } finally {
        setSearching(false);
      }
    },
    [excludeSessionId, friendsOnly]
  );

  function handleQueryChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 1) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => void fetchCandidates(q), 300);
  }

  // Sembunyikan yg sudah terpilih (filter saat render, bukan saat fetch —
  // supaya batal-pilih memunculkan lagi tanpa refetch).
  const selIds = new Set(selected.map((s) => s.id));
  const visibleResults = results.filter((r) => !selIds.has(r.id));

  function add(u: InviteCandidate) {
    onChange([...selected, u]);
    setQuery("");
    setResults([]);
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        {friendsOnly ? "Invite friends" : "Invite people"}{" "}
        <span className="text-muted-foreground font-normal">
          (they need to accept)
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
                aria-label="Remove"
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
          placeholder={friendsOnly ? "Search friends…" : "Search name or email…"}
          className="w-full h-11 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </div>

      {/* Hasil search — muncul hanya setelah mengetik (kedua mode) */}
      {query.trim().length > 0 && (
        <div className="mt-1.5 rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
          {searching ? (
            <div className="p-3 text-center">
              <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : visibleResults.length === 0 ? (
            <p className="p-3 text-center text-xs text-muted-foreground">
              {friendsOnly
                ? "No matching friends. A friends-only table can only invite friends."
                : "No matching users."}
            </p>
          ) : (
            visibleResults.map((u) => (
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
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm truncate">{u.name}</p>
                    {/* Badge level (warna per KEY — nama bisa diganti admin) */}
                    <span
                      className={
                        "shrink-0 inline-flex items-center rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider " +
                        (u.membership_key === "vip"
                          ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                          : u.membership_key === "premium"
                            ? "bg-primary/15 text-primary border-primary/30"
                            : "bg-muted text-muted-foreground border-border")
                      }
                    >
                      {u.membership_name}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {u.username ? `@${u.username}` : u.email}
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
