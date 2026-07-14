"use client";

import * as React from "react";
import Link from "next/link";
import { Star, MapPin, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { Pagination } from "@/components/admin/Pagination";
import { initials } from "@/lib/utils";
import type {
  UserReviewEntry,
  UserTableHistoryEntry,
  SessionVisibility,
} from "@/types/db";
import type { FriendPerson } from "@/lib/friends";

const PAGE_SIZE = 5;

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function visibilityLabel(v: SessionVisibility): string {
  if (v === "public") return "Publik";
  if (v === "friends") return "Teman";
  return "Invite";
}

/** Hook pagination kecil utk list client. */
function usePaged<T>(items: T[]) {
  const [page, setPage] = React.useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );
  return { pageItems, page: safePage, totalPages, setPage };
}

export function CustomerReviews({ reviews }: { reviews: UserReviewEntry[] }) {
  const { pageItems, page, totalPages, setPage } = usePaged(reviews);

  if (reviews.length === 0) {
    return (
      <Card className="p-6 text-center border-dashed">
        <p className="text-sm text-muted-foreground">
          No reviews for this customer yet.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {pageItems.map((rv) => (
        <Card key={rv.id} className="p-3">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 shrink-0">
              {rv.rater_avatar && <AvatarImage src={rv.rater_avatar} />}
              <AvatarFallback className="text-[10px]">
                {initials(rv.rater_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {rv.rater_name}
                </span>
                <span className="flex items-center gap-0.5 text-xs text-primary shrink-0">
                  <Star className="h-3 w-3 fill-primary" />
                  {rv.stars}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {fmtDateTime(rv.created_at)}
              </span>
            </div>
          </div>
          {rv.tags.length > 0 && (
            <HobbyBadges hobbies={rv.tags} max={10} className="mt-2" />
          )}
        </Card>
      ))}
      {totalPages > 1 && (
        <div className="flex justify-end pt-1">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

export function CustomerHistory({
  history,
}: {
  history: UserTableHistoryEntry[];
}) {
  const { pageItems, page, totalPages, setPage } = usePaged(history);

  if (history.length === 0) {
    return (
      <Card className="p-6 text-center border-dashed">
        <p className="text-sm text-muted-foreground">
          No open-table history yet.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {pageItems.map((h) => (
        <Link
          key={h.session_id}
          href={`/admin/transactions/${h.session_id}`}
          className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3 transition hover:bg-muted/40 group"
        >
          <div className="h-9 w-9 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              Table {h.table_label}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {h.area_name}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {fmtDateTime(h.started_at)} · {visibilityLabel(h.visibility)}
              {h.is_host && " · host"}
            </p>
          </div>
          {/* Keluar sebelum meja ditutup → tandai di riwayat. */}
          {(h.member_status === "left" || h.member_status === "kicked") && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {h.member_status === "kicked" ? "Removed" : "Left"}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] shrink-0">
            {h.status === "closed"
              ? "Done"
              : h.status === "cancelled"
                ? "Cancelled"
                : "Not paid"}
          </Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
        </Link>
      ))}
      {totalPages > 1 && (
        <div className="flex justify-end pt-1">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

/* ---------- Daftar teman (PRD Friends req. i) ---------- */
export function CustomerFriends({ friends }: { friends: FriendPerson[] }) {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(friends.length / PAGE_SIZE));
  const slice = friends.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (friends.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
        No friends yet.
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {slice.map((f) => (
        <Link
          key={f.id}
          href={`/admin/users/${f.id}`}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40 transition group"
        >
          <Avatar className="h-9 w-9 shrink-0">
            {f.avatar_url && <AvatarImage src={f.avatar_url} />}
            <AvatarFallback className="text-xs">
              {initials(f.display_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate group-hover:text-primary transition">
              {f.display_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {f.username ? `@${f.username} · ` : ""}
              Friends since {fmtDateTime(f.since)}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
        </Link>
      ))}
      {totalPages > 1 && (
        <div className="flex justify-end pt-1">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
