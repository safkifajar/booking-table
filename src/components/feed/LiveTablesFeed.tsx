import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Lock, Sparkles, ChevronRight, MapPin, Check } from "lucide-react";
import { initials, cn } from "@/lib/utils";
import type { ActiveSessionView } from "@/types/db";

interface Props {
  sessions: ActiveSessionView[];
  /** Anon mode: card link ke /auth bukan ke session preview */
  isAnon?: boolean;
  /** Session yang DIIKUTI user ini → kartu ditandai "You're in". */
  joinedIds?: string[];
  /** Profile id penonton — badge "You're in" tak tampil di meja miliknya. */
  viewerId?: string | null;
}

/** "HH:MM" dari ISO — sama dgn helper di Booking Schedule. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/** Label visibility — samakan dgn Booking Schedule di halaman denah. */
function visibilityLabel(v: ActiveSessionView["visibility"]): string {
  if (v === "public") return "Public";
  if (v === "friends") return "Friends";
  return "Invite only";
}

/**
 * Feed list meja aktif sekarang — IG-style card vertikal.
 *
 * Card lengkap clickable → /session/[id]/preview (atau /auth kalau anon).
 * Empty state: "Belum ada meja aktif" + CTA buka meja sendiri.
 */
export function LiveTablesFeed({
  sessions,
  isAnon,
  joinedIds,
  viewerId,
}: Props) {
  const joined = new Set(joinedIds ?? []);
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-gradient-to-b from-card to-primary/[0.04] p-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
          <Sparkles className="h-7 w-7 text-primary/70" />
        </div>
        <p className="text-sm font-medium mb-1">No active tables yet</p>
        <p className="text-xs text-muted-foreground">
          Be the first. Open your own table and invite your friends.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((s) => (
        <TableCard
          key={s.id}
          session={s}
          isAnon={isAnon}
          // Host tak perlu ditandai — dia jelas tahu itu mejanya sendiri.
          isJoined={joined.has(s.id) && s.host_id !== viewerId}
        />
      ))}
    </div>
  );
}

function TableCard({
  session,
  isAnon,
  isJoined,
}: {
  session: ActiveSessionView;
  isAnon?: boolean;
  isJoined?: boolean;
}) {
  // Meja public → langsung tampilan penuh (/session): ada tab + "Minta gabung".
  // Meja friends/invite_only → preview saja (bukan untuk umum).
  const target =
    session.visibility === "public"
      ? `/session/${session.id}`
      : `/session/${session.id}/preview`;
  const href = isAnon
    ? `/auth?next=${encodeURIComponent(target)}`
    : target;

  const isLocked = session.status === "locked";

  return (
    <Link
      href={href}
      // Background disamakan dgn kartu Booking Schedule (Card polos, tanpa
      // tint) — penanda keikutsertaan cukup lewat badge "You're in".
      className="block group rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-muted/40 transition overflow-hidden"
    >
      <div className="p-4 flex items-start gap-3">
        {/* Avatar host — pola sama dgn kartu Booking Schedule */}
        <Avatar className="h-9 w-9 shrink-0">
          {session.host_avatar && (
            <AvatarImage src={session.host_avatar} alt={session.host_name} />
          )}
          <AvatarFallback className="text-[10px]">
            {initials(session.host_name)}
          </AvatarFallback>
        </Avatar>

        {/* Kiri: host → judul → badges → vibe (SUSUNAN SAMA dgn Booking
            Schedule, supaya dua halaman konsisten). */}
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate group-hover:text-primary transition">
            {session.host_name}
          </p>

          {/* Judul meja (deskripsi) — italic seperti Booking Schedule. */}
          {session.title && (
            <p className="text-xs italic text-muted-foreground/90 truncate">
              {session.title}
            </p>
          )}

          {/* Jam booking (mulai–selesai), sama seperti Booking Schedule.
              Walk-in tanpa reservasi → fallback jam mulai sesi. */}
          <p className="text-xs text-muted-foreground tabular-nums">
            {session.reservation_at
              ? `${formatTime(session.reservation_at)}${
                  session.reservation_end_at
                    ? `–${formatTime(session.reservation_end_at)}`
                    : ""
                }`
              : `from ${formatTime(session.started_at)}`}
          </p>

          {/* Visibility + area + status khusus */}
          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {visibilityLabel(session.visibility)}
            </Badge>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/80">
              <MapPin className="h-3 w-3" />
              {session.area_name}
            </span>
            {isLocked && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400">
                <Lock className="h-3 w-3" /> Locked
              </span>
            )}
            {isJoined && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 border border-primary/40 px-1.5 py-0 text-[10px] font-medium text-primary">
                <Check className="h-3 w-3" /> You&apos;re in
              </span>
            )}
          </div>

          {/* Vibe tags */}
          {session.vibe_tags && session.vibe_tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {session.vibe_tags.slice(0, 4).map((v) => (
                <span
                  key={v}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
                >
                  {v}
                </span>
              ))}
              {session.vibe_tags.length > 4 && (
                <span className="text-[10px] text-muted-foreground/60">
                  +{session.vibe_tags.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Kanan: nomor meja → status → sisa kursi (IDENTIK Booking Schedule) */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="default" className="text-[10px] px-1.5">
            {session.table_label}
          </Badge>
          <span className="text-[11px] text-emerald-400">In use</span>
          {session.table_capacity > 0 &&
            (session.table_capacity - session.member_count > 0 ? (
              <span className="text-[10px] text-muted-foreground/80">
                {session.table_capacity - session.member_count} seats left
              </span>
            ) : (
              <span className="text-[10px] text-primary/80">Full</span>
            ))}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0 mt-2" />
      </div>
    </Link>
  );
}
