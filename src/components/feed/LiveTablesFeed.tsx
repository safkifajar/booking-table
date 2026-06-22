import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { Users, Crown, Lock, Sparkles, ChevronRight } from "lucide-react";
import { initials } from "@/lib/utils";
import type { ActiveSessionView } from "@/types/db";

interface Props {
  sessions: ActiveSessionView[];
  /** Anon mode: card link ke /auth bukan ke session preview */
  isAnon?: boolean;
}

/**
 * Feed list meja aktif sekarang — IG-style card vertikal.
 *
 * Card lengkap clickable → /session/[id]/preview (atau /auth kalau anon).
 * Empty state: "Belum ada meja aktif" + CTA buka meja sendiri.
 */
export function LiveTablesFeed({ sessions, isAnon }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <Sparkles className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium mb-1">Belum ada meja aktif</p>
        <p className="text-xs text-muted-foreground">
          Jadi yang pertama — buka meja sendiri dan undang temanmu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((s) => (
        <TableCard key={s.id} session={s} isAnon={isAnon} />
      ))}
    </div>
  );
}

function TableCard({
  session,
  isAnon,
}: {
  session: ActiveSessionView;
  isAnon?: boolean;
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
      className="block group rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-primary/[0.03] transition overflow-hidden"
    >
      <div className="p-4 flex items-start gap-3">
        <Avatar className="h-12 w-12 ring-2 ring-primary/20">
          {session.host_avatar && (
            <AvatarImage src={session.host_avatar} alt={session.host_name} />
          )}
          <AvatarFallback>{initials(session.host_name)}</AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="default" className="text-[10px] px-1.5">
              {session.table_label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {session.area_name}
            </span>
            {isLocked && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400">
                <Lock className="h-3 w-3" /> Locked
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold truncate group-hover:text-primary transition">
            {session.title ?? "Open Table"}
          </h3>

          {/* Host + count */}
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <Crown className="h-3 w-3 text-primary/70" />
            <span className="truncate">{session.host_name}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Users className="h-3 w-3" />
              {session.member_count}/{session.table_capacity}
            </span>
            <span>·</span>
            <RelativeTime
              date={session.started_at}
              className="text-xs whitespace-nowrap"
            />
          </div>

          {/* Vibe tags */}
          {session.vibe_tags && session.vibe_tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {session.vibe_tags.slice(0, 4).map((v) => (
                <span
                  key={v}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
                >
                  {v}
                </span>
              ))}
            </div>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0 mt-2" />
      </div>
    </Link>
  );
}
