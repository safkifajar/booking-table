"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Loader2, Crown } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RatingStars } from "@/components/network/RatingStars";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { searchNetworkUsers } from "@/lib/customer-actions";
import { initials } from "@/lib/utils";
import type {
  ActiveNetworkUser,
  NetworkSearchUser,
  SessionVisibility,
} from "@/types/db";

function visibilityLabel(v: SessionVisibility): string {
  if (v === "public") return "Publik";
  if (v === "friends") return "Teman";
  return "Undangan";
}

export function NetworkView({
  activeUsers,
  myProfileId,
}: {
  activeUsers: ActiveNetworkUser[];
  myProfileId: string | null;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<NetworkSearchUser[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  const trimmed = query.trim();

  // Debounced search (300ms). Reset state dilakukan di handler onChange (bukan
  // sinkron di effect) supaya tidak memicu cascading render.
  React.useEffect(() => {
    if (trimmed.length < 1) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchNetworkUsers(trimmed);
        setResults(res);
      } finally {
        setSearching(false);
        setSearched(true);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [trimmed]);

  function handleChange(value: string) {
    setQuery(value);
    if (value.trim().length < 1) {
      setResults([]);
      setSearched(false);
      setSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* SEARCH */}
      <section>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Cari user berdasarkan nama…"
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-9 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Hasil search */}
        {trimmed.length > 0 && (
          <div className="mt-3 space-y-2">
            {searched && results.length === 0 && !searching && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Tidak ada user dengan nama itu.
              </p>
            )}
            {results.map((u) => (
              <UserRow
                key={u.id}
                id={u.id}
                name={u.display_name}
                avatarUrl={u.avatar_url}
                hobbies={u.hobbies}
                rating={u.rating}
                isMe={u.id === myProfileId}
              />
            ))}
          </div>
        )}
      </section>

      {/* LAGI DI SOHO — sembunyikan saat sedang search supaya fokus */}
      {trimmed.length === 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            Lagi di SOHO sekarang
            {activeUsers.length > 0 && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground/70">
                · {activeUsers.length} orang
              </span>
            )}
          </h2>

          {activeUsers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Belum ada yang nongkrong sekarang.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Cek lagi nanti atau cari user di atas.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeUsers.map((u) => (
                <ActiveUserRow
                  key={u.profile_id + u.session_id}
                  user={u}
                  isMe={u.profile_id === myProfileId}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Baris hasil search — klik ke detail profil. */
function UserRow({
  id,
  name,
  avatarUrl,
  hobbies,
  rating,
  isMe,
}: {
  id: string;
  name: string;
  avatarUrl: string | null;
  hobbies: string[];
  rating: NetworkSearchUser["rating"];
  isMe: boolean;
}) {
  return (
    <Link
      href={`/network/${id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3 transition hover:bg-muted/40"
    >
      <Avatar className="h-11 w-11 shrink-0">
        {avatarUrl && <AvatarImage src={avatarUrl} />}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-medium text-sm truncate">{name}</p>
          {isMe && (
            <span className="text-[10px] px-1 py-0 rounded border border-border text-muted-foreground">
              kamu
            </span>
          )}
        </div>
        <RatingStars rating={rating} className="mt-0.5" />
        <HobbyBadges hobbies={hobbies} max={4} className="mt-1.5" />
      </div>
    </Link>
  );
}

/** Baris user yg lagi nongkrong — tampil meja + tipe; tombol Gabung kalau public. */
function ActiveUserRow({
  user,
  isMe,
}: {
  user: ActiveNetworkUser;
  isMe: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3">
      <Link href={`/network/${user.profile_id}`} className="shrink-0">
        <Avatar className="h-11 w-11">
          {user.avatar_url && <AvatarImage src={user.avatar_url} />}
          <AvatarFallback>{initials(user.display_name)}</AvatarFallback>
        </Avatar>
      </Link>
      <Link href={`/network/${user.profile_id}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-medium text-sm truncate">{user.display_name}</p>
          {user.is_host && (
            <Crown className="h-3 w-3 text-primary shrink-0" aria-label="Host" />
          )}
          {isMe && (
            <span className="text-[10px] px-1 py-0 rounded border border-border text-muted-foreground">
              kamu
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Meja {user.table_label} · {visibilityLabel(user.visibility)}
        </p>
      </Link>
      {/* Gabung hanya untuk meja public & bukan sesi diri sendiri */}
      {!isMe && user.visibility === "public" && (
        <Link
          href={`/session/${user.session_id}`}
          className="shrink-0 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20"
        >
          Gabung
        </Link>
      )}
    </div>
  );
}
