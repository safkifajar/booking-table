"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Loader2, Crown, SlidersHorizontal, X } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RatingStars } from "@/components/network/RatingStars";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { HobbyFilterSheet } from "@/components/network/HobbyFilterSheet";
import { listAllMembers } from "@/lib/customer-actions";
import { cn, initials } from "@/lib/utils";
import type {
  ActiveNetworkUser,
  NetworkSearchUser,
  SessionVisibility,
} from "@/types/db";

function visibilityLabel(v: SessionVisibility): string {
  if (v === "public") return "Public";
  if (v === "friends") return "Friends";
  return "Invite only";
}

type Tab = "here" | "all";

export function NetworkView({
  activeUsers,
  myProfileId,
  myActiveSessionIds = [],
  popularHobbies,
}: {
  activeUsers: ActiveNetworkUser[];
  myProfileId: string | null;
  myActiveSessionIds?: string[];
  popularHobbies: string[];
}) {
  const [tab, setTab] = React.useState<Tab>("here");
  const mySessions = React.useMemo(
    () => new Set(myActiveSessionIds),
    [myActiveSessionIds]
  );

  return (
    <div>
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1 mb-4">
        <TabButton active={tab === "here"} onClick={() => setTab("here")}>
          At SOHO now
          {activeUsers.length > 0 && (
            <span className="ml-1.5 text-xs opacity-70">
              {activeUsers.length}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All members
        </TabButton>
      </div>

      {tab === "here" ? (
        <HereTab
          activeUsers={activeUsers}
          myProfileId={myProfileId}
          mySessions={mySessions}
        />
      ) : (
        <AllMembersTab
          myProfileId={myProfileId}
          popularHobbies={popularHobbies}
        />
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
  mySessions,
}: {
  activeUsers: ActiveNetworkUser[];
  myProfileId: string | null;
  mySessions: Set<string>;
}) {
  if (activeUsers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No one's hanging out right now.
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Check the All members tab to see who you can reach out to.
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
          alreadyInSession={mySessions.has(u.session_id)}
        />
      ))}
    </div>
  );
}

/** Tab "Semua member" — search + filter hobi + infinite scroll (batch 15). */
function AllMembersTab({
  myProfileId,
  popularHobbies,
}: {
  myProfileId: string | null;
  popularHobbies: string[];
}) {
  const [query, setQuery] = React.useState("");
  const [selectedHobbies, setSelectedHobbies] = React.useState<string[]>([]);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [items, setItems] = React.useState<NetworkSearchUser[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [initialLoaded, setInitialLoaded] = React.useState(false);

  const trimmed = query.trim();
  // Key stabil utk effect: hobi terpilih (urut) sbg string.
  const hobbyKey = [...selectedHobbies].sort().join("\n");
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  // requestId menjaga supaya respons lama (filter berbeda) tidak menimpa hasil baru.
  const reqRef = React.useRef(0);

  function removeHobby(h: string) {
    setSelectedHobbies((prev) => prev.filter((x) => x !== h));
  }

  // Muat halaman pertama tiap kali query / filter hobi berubah (debounced 300ms).
  React.useEffect(() => {
    const myReq = ++reqRef.current;
    const hobbies = hobbyKey ? hobbyKey.split("\n") : [];
    const t = setTimeout(async () => {
      setInitialLoaded(false);
      setLoading(true);
      try {
        const page = await listAllMembers({
          query: trimmed,
          cursor: null,
          hobbies,
        });
        if (reqRef.current !== myReq) return; // filter sudah ganti
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
  }, [trimmed, hobbyKey]);

  const loadMore = React.useCallback(async () => {
    if (loading || !hasMore || !cursor) return;
    const myReq = reqRef.current;
    const hobbies = hobbyKey ? hobbyKey.split("\n") : [];
    setLoading(true);
    try {
      const page = await listAllMembers({ query: trimmed, cursor, hobbies });
      if (reqRef.current !== myReq) return;
      setItems((prev) => [...prev, ...page.users]);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor !== null);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  }, [loading, hasMore, cursor, trimmed, hobbyKey]);

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
      {/* Search + tombol Filter */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members by name…"
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
        </div>
        {popularHobbies.length > 0 && (
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition",
              selectedHobbies.length > 0
                ? "border-primary bg-primary/15 text-primary font-medium"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
            )}
            aria-label="Filter by hobby"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Filter</span>
            {selectedHobbies.length > 0 && (
              <span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none">
                {selectedHobbies.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Chip hobi terpilih (bisa dilepas) */}
      {selectedHobbies.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {selectedHobbies.map((h) => (
            <span
              key={h}
              className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs text-primary"
            >
              {h}
              <button
                type="button"
                onClick={() => removeHobby(h)}
                aria-label={`Remove filter ${h}`}
                className="hover:text-primary/70"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setSelectedHobbies([])}
            className="text-xs text-muted-foreground hover:text-foreground ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      <HobbyFilterSheet
        key={filterOpen ? "open" : "closed"}
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        hobbies={popularHobbies}
        selected={selectedHobbies}
        onApply={setSelectedHobbies}
      />

      {initialLoaded && items.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {trimmed.length > 0 || selectedHobbies.length > 0
            ? "No members match the filter."
            : "No members yet."}
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
          All members shown.
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
              you
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
  alreadyInSession,
}: {
  user: ActiveNetworkUser;
  isMe: boolean;
  alreadyInSession: boolean;
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
              you
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Table {user.table_label} · {visibilityLabel(user.visibility)}
        </p>
      </Link>
      {/* Gabung: meja public, bukan diri sendiri, & viewer belum di meja itu.
          Kalau viewer sudah di sesi yg sama → tampilkan "Semeja". */}
      {!isMe && alreadyInSession ? (
        <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
          Same table
        </span>
      ) : (
        !isMe &&
        user.visibility === "public" && (
          <Link
            href={`/session/${user.session_id}?from=${encodeURIComponent("/network")}`}
            className="shrink-0 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20"
          >
            Join
          </Link>
        )
      )}
    </div>
  );
}
