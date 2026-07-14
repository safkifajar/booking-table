"use client";

import * as React from "react";
import Link from "next/link";
import {
  Search,
  Loader2,
  SlidersHorizontal,
  X,
  MapPin,
  GraduationCap,
  Cake,
  UserPlus,
  UserCheck,
  Check,
} from "lucide-react";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { RatingStars } from "@/components/network/RatingStars";
import { HobbyFilterSheet } from "@/components/network/HobbyFilterSheet";
import { ProfilePhotoCarousel } from "@/app/profile/ProfilePhotoCarousel";
import { listAllMembers } from "@/lib/customer-actions";
import { sendFriendRequest } from "@/lib/friend-actions";
import { toast } from "sonner";
import { getActionErrorMessage } from "@/lib/utils";
import { educationLabel } from "@/lib/education";
import { cn } from "@/lib/utils";
import type { NetworkSearchUser } from "@/types/db";
import type { HobbyGroup } from "@/lib/hobbies";

/**
 * Feed "Discover" ala CMB — kartu foto besar semua member. Prioritas urutan
 * berdasar `interestedIn` viewer (cewe/cowo duluan, sisanya tetap muncul).
 * Search nama + filter hobi + infinite scroll (batch 15).
 */
export function NetworkView({
  myProfileId,
  interestCatalog,
  interestedIn,
}: {
  myProfileId: string | null;
  interestCatalog: HobbyGroup[];
  interestedIn: "male" | "female" | "both" | "";
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
  const hobbyKey = [...selectedHobbies].sort().join("\n");
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const feedScrollRef = React.useRef<HTMLDivElement | null>(null);
  const reqRef = React.useRef(0);

  function removeHobby(h: string) {
    setSelectedHobbies((prev) => prev.filter((x) => x !== h));
  }

  // Halaman pertama saat query / filter berubah (debounce 300ms).
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
          interestedIn,
        });
        if (reqRef.current !== myReq) return;
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
  }, [trimmed, hobbyKey, interestedIn]);

  const loadMore = React.useCallback(async () => {
    if (loading || !hasMore || !cursor) return;
    const myReq = reqRef.current;
    const hobbies = hobbyKey ? hobbyKey.split("\n") : [];
    setLoading(true);
    try {
      const page = await listAllMembers({
        query: trimmed,
        cursor,
        hobbies,
        interestedIn,
      });
      if (reqRef.current !== myReq) return;
      setItems((prev) => [...prev, ...page.users]);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor !== null);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  }, [loading, hasMore, cursor, trimmed, hobbyKey, interestedIn]);

  // Infinite scroll.
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      // root = kontainer feed (scroll internal), bukan viewport.
      { root: feedScrollRef.current, rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  return (
    <div>
      {/* Judul + search + filter — DIAM (di luar area scroll feed). Feed
          scroll di kontainernya sendiri → kontrol ini tak bergerak sedikit
          pun (bukan sticky yg sempat geser saat mulai scroll). */}
      <div className="border-b border-border bg-background/95 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-3">
          {/* Search + Filter (judul 'Network' + logo ada di header atas) */}
          <div className="flex items-center gap-2">
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
            {interestCatalog.length > 0 && (
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

          {/* Chip hobi terpilih (di dalam sticky biar ikut kelihatan) */}
          {selectedHobbies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
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
        </div>
      </div>

      {/* Konten feed — SATU area scroll internal (kontrol di atas tetap diam,
          persis pola tab Floor/Menu). Tinggi = sisa layar s/d atas bottom nav.
          Header global (logo+Network) + search/filter + bottom nav ≈ 11.5rem. */}
      <div
        ref={feedScrollRef}
        className="max-h-[calc(100dvh-11.5rem)] overflow-y-auto overscroll-contain"
      >
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-4">
      <HobbyFilterSheet
        key={filterOpen ? "open" : "closed"}
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        catalog={interestCatalog}
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

      {/* Feed kartu besar */}
      <div className="space-y-5">
        {items.map((u) => (
          <MemberCard key={u.id} user={u} isMe={u.id === myProfileId} />
        ))}
      </div>

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
      </div>
    </div>
  );
}

/** Kartu member ala CMB — foto carousel + umur/lokasi/education + rating/hobi. */
function MemberCard({
  user,
  isMe,
}: {
  user: NetworkSearchUser;
  isMe: boolean;
}) {
  const eduLabel = educationLabel(user.education);

  return (
    // Kartu SENGAJA tidak dibungkus satu <Link> besar: carousel foto punya
    // <button> (buka viewer), dan <button> di dalam <a> = HTML tak valid →
    // klik foto ikut menavigasi ke halaman detail, sehingga saat viewer foto
    // ditutup user mendarat di detail, bukan balik ke list. Solusinya: FOTO di
    // luar Link (klik = buka viewer), blok INFO yang jadi Link (klik = detail).
    <div className="overflow-hidden rounded-2xl border border-border bg-card/40 transition hover:border-foreground/20">
      <div className="relative">
        <ProfilePhotoCarousel
          photos={user.photos}
          displayName={user.display_name}
          fullWidth
        />
        {/* Badge "At SOHO now" */}
        {user.at_soho && (
          <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            At SOHO now
          </span>
        )}
      </div>

      <div className="p-4">
        {/* Baris nama + tombol Add friend SEJAJAR. Tombol di LUAR <Link>
            (button dalam <a> = HTML tak valid), jadi baris ini dipecah:
            nama = link, tombol = sibling. */}
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/network/${user.id}`}
            className="flex items-center gap-2 flex-wrap flex-1 min-w-0"
          >
            <h3 className="text-lg font-bold tracking-tight truncate">
              {user.display_name}
            </h3>
            {isMe && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                you
              </span>
            )}
          </Link>
          {!isMe && <CardFriendButton user={user} />}
        </div>

      <Link href={`/network/${user.id}`} className="block">
        {user.username && (
          <div className="text-sm text-muted-foreground">@{user.username}</div>
        )}

        {user.area && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">{user.area}</span>
          </div>
        )}
        {user.age !== null && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Cake className="h-3.5 w-3.5 shrink-0" />
            <span>{user.age} yrs</span>
          </div>
        )}
        {eduLabel && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <GraduationCap className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">{eduLabel}</span>
          </div>
        )}

        <div className="mt-2.5">
          <RatingStars rating={user.rating} />
        </div>
        {user.hobbies.length > 0 && (
          <HobbyBadges hobbies={user.hobbies} max={4} className="mt-2.5" />
        )}
      </Link>
      </div>
    </div>
  );
}

/**
 * Tombol pertemanan kecil di kartu — sebaris dengan nama (PRD Friends k).
 * none -> Add (kirim request, optimistic) · pending_out -> Requested ·
 * pending_in -> Respond (ke profil) · friends -> Friends · blocked -> kosong.
 */
function CardFriendButton({ user }: { user: NetworkSearchUser }) {
  // Optimistic: setelah kirim sukses, langsung tampil "Requested" tanpa
  // menunggu refresh list.
  const [localStatus, setLocalStatus] = React.useState<
    NetworkSearchUser["friend_status"] | null
  >(null);
  const [busy, setBusy] = React.useState(false);
  const status = localStatus ?? user.friend_status;

  const chip =
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow backdrop-blur-sm";

  if (status === "blocked") return null;

  if (status === "friends") {
    return (
      <span className={cn(chip, "bg-black/55 text-white")}>
        <UserCheck className="h-3.5 w-3.5" /> Friends
      </span>
    );
  }

  if (status === "pending_out") {
    return (
      <span className={cn(chip, "bg-black/55 text-white/90")}>
        <Check className="h-3.5 w-3.5" /> Requested
      </span>
    );
  }

  if (status === "pending_in") {
    // Respon (accept/decline) dilakukan di profil — butuh konfirmasi jelas.
    return (
      <Link
        href={`/network/${user.id}`}
        className={cn(chip, "bg-primary text-primary-foreground")}
      >
        <UserPlus className="h-3.5 w-3.5" /> Respond
      </Link>
    );
  }

  // none
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await sendFriendRequest({ targetId: user.id });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          setLocalStatus(res.status);
          toast.success(
            res.status === "friends"
              ? `You are now friends with ${user.display_name}`
              : "Friend request sent"
          );
        } catch (err) {
          toast.error(getActionErrorMessage(err, "Failed to send request"));
        } finally {
          setBusy(false);
        }
      }}
      className={cn(chip, "bg-primary text-primary-foreground disabled:opacity-60")}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <UserPlus className="h-3.5 w-3.5" />
      )}
      Add
    </button>
  );
}
