"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Loader2, Crown } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RatingStars } from "@/components/network/RatingStars";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { listAllMembers } from "@/lib/customer-actions";
import { cn, initials } from "@/lib/utils";
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

type Tab = "here" | "all";

export function NetworkView({
  activeUsers,
  myProfileId,
}: {
  activeUsers: ActiveNetworkUser[];
  myProfileId: string | null;
}) {
  const [tab, setTab] = React.useState<Tab>("here");

  return (
    <div>
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1 mb-4">
        <TabButton active={tab === "here"} onClick={() => setTab("here")}>
          Lagi di SOHO
          {activeUsers.length > 0 && (
            <span className="ml-1.5 text-xs opacity-70">
              {activeUsers.length}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          Semua member
        </TabButton>
      </div>

      {tab === "here" ? (
        <HereTab activeUsers={activeUsers} myProfileId={myProfileId} />
      ) : (
        <AllMembersTab myProfileId={myProfileId} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** Tab "Lagi di SOHO" — user yg sedang nongkrong di meja open/locked. */
function HereTab({
  activeUsers,
  myProfileId,
}: {
  activeUsers: ActiveNetworkUser[];
  myProfileId: string | null;
}) {
  if (activeUsers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Belum ada yang nongkrong sekarang.
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Cek tab Semua member untuk lihat siapa yang bisa diajak.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {activeUsers.map((u) => (
        <ActiveUserRow
          key={u.profile_id + u.session_id}
          user={u}
          isMe={u.profile_id === myProfileId}
        />
      ))}
    </div>
  );
}

/** Tab "Semua member" — search + infinite scroll (batch 15). */
function AllMembersTab({ myProfileId }: { myProfileId: string | null }) {
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<NetworkSearchUser[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [initialLoaded, setInitialLoaded] = React.useState(false);

  const trimmed = query.trim();
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  // requestId menjaga supaya respons lama (query berbeda) tidak menimpa hasil baru.
  const reqRef = React.useRef(0);

  // Muat halaman pertama tiap kali query berubah (debounced 300ms).
  React.useEffect(() => {
    const myReq = ++reqRef.current;
    const t = setTimeout(async () => {
      setInitialLoaded(false);
      setLoading(true);
      try {
        const page = await listAllMembers({ query: trimmed, cursor: null });
        if (reqRef.current !== myReq) return; // query sudah ganti
        setItems(page.users);
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor !== null);
      } finally {
        if (reqRef.current === myReq) {
          setLoading(false);
          setInitialLoaded(true);
        }
      }
    }, 300);
    return () => clearTimeout(t);
  }, [trimmed]);

  const loadMore = React.useCallback(async () => {
    if (loading || !hasMore || !cursor) return;
    const myReq = reqRef.current;
    setLoading(true);
    try {
      const page = await listAllMembers({ query: trimmed, cursor });
      if (reqRef.current !== myReq) return;
      setItems((prev) => [...prev, ...page.users]);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor !== null);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  }, [loading, hasMore, cursor, trimmed]);

  // Infinite scroll: load saat sentinel masuk viewport.
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari member berdasarkan nama…"
          className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-9 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {initialLoaded && items.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {trimmed.length > 0
            ? "Tidak ada member dengan nama itu."
            : "Belum ada member."}
        </p>
      )}

      <div className="space-y-2">
        {items.map((u) => (
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

      {/* Sentinel + loader */}
      <div ref={sentinelRef} className="h-1" />
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {!hasMore && items.length > 0 && (
        <p className="text-center text-xs text-muted-foreground/60 py-4">
          Semua member sudah tampil.
        </p>
      )}
    </div>
  );
}

/** Baris member (tab semua / hasil search) — klik ke detail profil. */
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
