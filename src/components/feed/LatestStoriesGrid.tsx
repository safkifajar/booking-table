"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Camera, MapPin } from "lucide-react";
import { initials } from "@/lib/utils";
import { StoryViewer } from "@/components/story/StoryViewer";
import type { FeedStoryItem } from "@/lib/story-actions";

interface Props {
  stories: FeedStoryItem[];
  /** Bar ID untuk story viewer modal */
  barId: string;
  /** Current user ID — kalau null user belum login */
  viewerId: string | null;
}

/**
 * Grid 2×N foto-foto story terbaru di bar.
 *
 * Klik thumbnail → buka StoryViewer dimulai dari user pemilik story tersebut.
 * Anonymous user → redirect ke /auth.
 *
 * Realtime: parent component handle refresh via SSE bar channel (lihat
 * StoryBar.tsx — pattern sama).
 */
export function LatestStoriesGrid({ stories, barId, viewerId }: Props) {
  const router = useRouter();
  const [openUserId, setOpenUserId] = React.useState<string | null>(null);

  if (stories.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <Camera className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium mb-1">No stories yet</p>
        <p className="text-xs text-muted-foreground">
          Photo stories from other guests will show up here.
        </p>
      </div>
    );
  }

  function handleClick(userId: string) {
    if (!viewerId) {
      router.push("/auth?next=/");
      return;
    }
    setOpenUserId(userId);
  }

  // Unique user ids in latest-first order untuk navigation chain di viewer
  const orderedUserIds = Array.from(new Set(stories.map((s) => s.userId)));

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {stories.map((s) => (
          <StoryThumbnail
            key={s.id}
            story={s}
            onClick={() => handleClick(s.userId)}
          />
        ))}
      </div>

      {openUserId && viewerId && (
        <StoryViewer
          barId={barId}
          startUserId={openUserId}
          viewerId={viewerId}
          orderedUserIds={orderedUserIds}
          userMeta={Object.fromEntries(
            stories.map((s) => [
              s.userId,
              { displayName: s.displayName, avatarUrl: s.avatarUrl },
            ])
          )}
          onClose={() => setOpenUserId(null)}
        />
      )}
    </>
  );
}

function StoryThumbnail({
  story,
  onClick,
}: {
  story: FeedStoryItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-[9/16] rounded-lg overflow-hidden bg-zinc-900 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <Image
        src={story.imageUrl}
        alt={story.caption ?? `Story by ${story.displayName}`}
        fill
        className="object-cover transition group-hover:scale-105"
        sizes="(max-width: 640px) 50vw, 33vw"
      />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />

      {/* Top: avatar + name */}
      <div className="absolute top-2 left-2 right-2 flex items-center gap-1.5">
        <Avatar className="h-6 w-6 ring-1 ring-white/30">
          {story.avatarUrl && (
            <AvatarImage src={story.avatarUrl} alt={story.displayName} />
          )}
          <AvatarFallback className="text-[9px]">
            {initials(story.displayName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-[10px] text-white font-medium truncate">
          {story.displayName}
        </span>
      </div>

      {/* Bottom: caption + table */}
      <div className="absolute bottom-2 left-2 right-2 space-y-0.5">
        {story.table_label && (
          <div className="inline-flex items-center gap-0.5 text-[9px] text-white/90 bg-black/40 px-1.5 py-0.5 rounded-full">
            <MapPin className="h-2.5 w-2.5" />
            {story.table_label}
          </div>
        )}
        {story.caption && (
          <p className="text-[10px] text-white line-clamp-2 text-left">
            {story.caption}
          </p>
        )}
      </div>
    </button>
  );
}
