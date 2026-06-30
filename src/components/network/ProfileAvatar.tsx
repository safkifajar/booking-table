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
  const [menuOpen, setMenuOpen] = React.useState(false);

  const canStory = hasStory && !!viewerId;
  const canPhoto = !!avatarUrl;
  const clickable = canStory || canPhoto;
  // Punya story DAN foto → tap munculkan pilihan (ala Instagram).
  const hasChoice = canStory && canPhoto;

  function handleClick() {
    if (hasChoice) setMenuOpen(true);
    else if (canStory) setStoryOpen(true);
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
          aria-label={canStory ? "View Story" : "View Profile Photo"}
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

      {/* Pilihan: lihat story atau foto profil (ala Instagram) */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-full sm:max-w-xs rounded-t-2xl sm:rounded-2xl border border-border bg-card p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setStoryOpen(true);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted/50 transition"
            >
              View Story
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setPhotoOpen(true);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted/50 transition"
            >
              View Profile Photo
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="w-full text-center px-4 py-3 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
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
