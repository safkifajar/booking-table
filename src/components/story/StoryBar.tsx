"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Camera } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";
import { StoryUploader } from "./StoryUploader";
import { StoryViewer } from "./StoryViewer";
import type { StoryBarItem } from "@/lib/story-actions";

interface Props {
  barId: string;
  /** ID user yang lagi login — pakai untuk decide "Your Story" position */
  viewerId: string;
  /** Display name + avatar viewer (untuk "Your Story" bubble kalau belum upload) */
  viewerDisplayName: string;
  viewerAvatarUrl: string | null;
  initialItems: StoryBarItem[];
}

/**
 * Story bar — horizontal scroll list of users dengan active stories.
 *
 * Layout:
 * - Item 1: "Your Story" bubble (kalau belum punya) atau avatar kamu (kalau ada)
 * - Items 2+: avatar user lain yang lagi punya story aktif, dengan ring gold
 *   kalau ada unviewed story.
 *
 * Klik "Your Story" → open upload modal
 * Klik avatar user lain → open viewer modal di story user tersebut
 *
 * Realtime: subscribe SSE /api/realtime/bar/[barId] → kalau ada story.new
 * trigger router.refresh() untuk re-fetch via Server Component.
 */
export function StoryBar({
  barId,
  viewerId,
  viewerDisplayName,
  viewerAvatarUrl,
  initialItems,
}: Props) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState<string | null>(null); // userId

  // Realtime: refresh on story events
  React.useEffect(() => {
    if (!barId) return;
    const es = new EventSource(`/api/realtime/bar/${barId}`);
    es.onmessage = () => router.refresh();
    es.onerror = () => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] bar:${barId} disconnected, retrying...`);
      }
    };
    return () => es.close();
  }, [barId, router]);

  // Separate viewer's own item (taruh di paling kiri sebagai "Your Story")
  const ownItem = initialItems.find((it) => it.userId === viewerId);
  const otherItems = initialItems.filter((it) => it.userId !== viewerId);

  return (
    <>
      <div className="overflow-x-auto scrollbar-none -mx-4 px-4">
        <div className="flex gap-3 pb-2">
          {/* Your Story bubble */}
          <YourStoryBubble
            avatarUrl={ownItem ? viewerAvatarUrl : viewerAvatarUrl}
            displayName={viewerDisplayName}
            hasOwn={!!ownItem}
            onUpload={() => setUploadOpen(true)}
            onView={() => ownItem && setViewerOpen(viewerId)}
          />

          {/* Other users' stories */}
          {otherItems.map((item) => (
            <StoryItem
              key={item.userId}
              item={item}
              onClick={() => setViewerOpen(item.userId)}
            />
          ))}
        </div>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <StoryUploader
          barId={barId}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Viewer modal */}
      {viewerOpen && (
        <StoryViewer
          barId={barId}
          startUserId={viewerOpen}
          viewerId={viewerId}
          orderedUserIds={[
            ...(ownItem ? [viewerId] : []),
            ...otherItems.map((it) => it.userId),
          ]}
          onClose={() => setViewerOpen(null)}
        />
      )}
    </>
  );
}

function YourStoryBubble({
  avatarUrl,
  displayName,
  hasOwn,
  onUpload,
  onView,
}: {
  avatarUrl: string | null;
  displayName: string;
  hasOwn: boolean;
  onUpload: () => void;
  onView: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 w-[70px]">
      <div className="relative">
        <button
          type="button"
          onClick={hasOwn ? onView : onUpload}
          className={cn(
            "rounded-full p-[2px] transition",
            hasOwn
              ? "bg-gradient-to-tr from-primary via-amber-400 to-primary"
              : "bg-border hover:bg-muted-foreground/40"
          )}
          aria-label={hasOwn ? "Lihat story kamu" : "Upload story baru"}
        >
          <Avatar className="h-14 w-14 ring-2 ring-background">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="text-xs">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
        </button>
        {!hasOwn ? (
          <button
            type="button"
            onClick={onUpload}
            className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary border-2 border-background flex items-center justify-center hover:scale-110 transition"
            aria-label="Upload story baru"
          >
            <Plus className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onUpload}
            className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-card border-2 border-background flex items-center justify-center hover:scale-110 transition"
            aria-label="Tambah story"
          >
            <Camera className="h-3 w-3 text-primary" />
          </button>
        )}
      </div>
      <span className="text-[10px] text-center text-foreground/80 truncate w-full">
        {hasOwn ? "Story kamu" : "Story-mu"}
      </span>
    </div>
  );
}

function StoryItem({
  item,
  onClick,
}: {
  item: StoryBarItem;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 w-[70px]">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "rounded-full p-[2px] transition hover:scale-105",
          item.allViewed
            ? "bg-border"
            : "bg-gradient-to-tr from-primary via-amber-400 to-primary"
        )}
        aria-label={`Lihat story ${item.displayName}`}
      >
        <Avatar className="h-14 w-14 ring-2 ring-background">
          {item.avatarUrl && <AvatarImage src={item.avatarUrl} alt={item.displayName} />}
          <AvatarFallback className="text-xs">
            {initials(item.displayName)}
          </AvatarFallback>
        </Avatar>
      </button>
      <span className="text-[10px] text-center text-foreground/80 truncate w-full">
        {item.displayName}
      </span>
    </div>
  );
}
