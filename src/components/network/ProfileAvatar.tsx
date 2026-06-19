"use client";

import * as React from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { StoryViewer } from "@/components/story/StoryViewer";
import { AvatarViewer } from "@/components/network/AvatarViewer";
import { cn, initials } from "@/lib/utils";

/**
 * Avatar profil dgn perilaku klik kontekstual:
 * - Punya story aktif → ring gradient, klik = buka StoryViewer.
 * - Tidak ada story tapi punya foto → klik = lihat foto penuh (AvatarViewer).
 * - Tidak ada keduanya / belum login → avatar statis.
 *
 * Story butuh viewer login (viewerId). Visitor anonim: tetap bisa lihat foto.
 */
export function ProfileAvatar({
  userId,
  displayName,
  avatarUrl,
  hasStory,
  barId,
  viewerId,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  hasStory: boolean;
  barId: string;
  /** Id user login (null = anon). Story hanya bisa dibuka kalau ada. */
  viewerId: string | null;
}) {
  const [storyOpen, setStoryOpen] = React.useState(false);
  const [photoOpen, setPhotoOpen] = React.useState(false);

  const canStory = hasStory && !!viewerId;
  const canPhoto = !!avatarUrl;
  const clickable = canStory || canPhoto;

  function handleClick() {
    if (canStory) setStoryOpen(true);
    else if (canPhoto) setPhotoOpen(true);
  }

  const inner = (
    <Avatar className="h-24 w-24">
      {avatarUrl && <AvatarImage src={avatarUrl} />}
      <AvatarFallback className="text-2xl">
        {initials(displayName)}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <>
      {clickable ? (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "rounded-full transition active:scale-95",
            canStory &&
              "p-[3px] bg-gradient-to-tr from-primary to-amber-400 ring-0"
          )}
          aria-label={canStory ? "Lihat story" : "Lihat foto profil"}
        >
          {canStory ? (
            <span className="block rounded-full ring-2 ring-background">
              {inner}
            </span>
          ) : (
            inner
          )}
        </button>
      ) : (
        inner
      )}

      {storyOpen && viewerId && (
        <StoryViewer
          barId={barId}
          startUserId={userId}
          viewerId={viewerId}
          orderedUserIds={[userId]}
          onClose={() => setStoryOpen(false)}
        />
      )}
      {photoOpen && avatarUrl && (
        <AvatarViewer
          src={avatarUrl}
          alt={displayName}
          onClose={() => setPhotoOpen(false)}
        />
      )}
    </>
  );
}
