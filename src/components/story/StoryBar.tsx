"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Camera, ImageIcon, Type, X } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";
import { StoryUploader } from "./StoryUploader";
import { StoryTextComposer } from "./StoryTextComposer";
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
  const [pickerOpen, setPickerOpen] = React.useState(false); // sheet pilih Photo/Text
  const [uploadOpen, setUploadOpen] = React.useState(false); // composer foto
  const [textOpen, setTextOpen] = React.useState(false); // composer teks
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
      <div className="overflow-x-auto overflow-y-visible scrollbar-none -mx-4 px-4">
        <div className="flex gap-3 pt-2 pb-2">
          {/* Your Story bubble */}
          <YourStoryBubble
            avatarUrl={viewerAvatarUrl}
            displayName={viewerDisplayName}
            hasOwn={!!ownItem}
            storyCount={ownItem?.storyCount ?? 0}
            onUpload={() => setPickerOpen(true)}
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

      {/* Sheet pilih jenis story: Photo atau Text */}
      {pickerOpen && (
        <StoryTypePicker
          onClose={() => setPickerOpen(false)}
          onPhoto={() => {
            setPickerOpen(false);
            setUploadOpen(true);
          }}
          onText={() => {
            setPickerOpen(false);
            setTextOpen(true);
          }}
        />
      )}

      {/* Composer foto */}
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

      {/* Composer teks */}
      {textOpen && (
        <StoryTextComposer
          barId={barId}
          onClose={() => setTextOpen(false)}
          onCreated={() => {
            setTextOpen(false);
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
          userMeta={Object.fromEntries(
            initialItems.map((it) => [
              it.userId,
              { displayName: it.displayName, avatarUrl: it.avatarUrl },
            ])
          )}
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
  storyCount,
  onUpload,
  onView,
}: {
  avatarUrl: string | null;
  displayName: string;
  hasOwn: boolean;
  storyCount: number;
  onUpload: () => void;
  onView: () => void;
}) {
  const avatar = (
    <Avatar className="h-14 w-14 ring-2 ring-background">
      {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
      <AvatarFallback className="text-xs">
        {initials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 w-[70px]">
      <div className="relative">
        <button
          type="button"
          onClick={hasOwn ? onView : onUpload}
          className="transition hover:scale-105"
          aria-label={hasOwn ? "View your story" : "Upload new story"}
        >
          {hasOwn ? (
            // Story sendiri: ring merah tersegmentasi sesuai jumlah story.
            <StoryRing count={storyCount} viewed={false}>
              {avatar}
            </StoryRing>
          ) : (
            // Belum ada story: ring abu polos.
            <span className="inline-block rounded-full bg-border p-[3px] hover:bg-muted-foreground/40">
              {avatar}
            </span>
          )}
        </button>
        {!hasOwn ? (
          <button
            type="button"
            onClick={onUpload}
            className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary border-2 border-background flex items-center justify-center hover:scale-110 transition"
            aria-label="Upload new story"
          >
            <Plus className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onUpload}
            className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-card border-2 border-background flex items-center justify-center hover:scale-110 transition"
            aria-label="Add story"
          >
            <Camera className="h-3 w-3 text-primary" />
          </button>
        )}
      </div>
      <span className="text-[10px] text-center text-foreground/80 truncate w-full">
        {hasOwn ? "Your story" : "Your story"}
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
        className="transition hover:scale-105"
        aria-label={`View ${item.displayName}'s story`}
      >
        <StoryRing count={item.storyCount} viewed={item.allViewed}>
          <Avatar className="h-14 w-14 ring-2 ring-background">
            {item.avatarUrl && <AvatarImage src={item.avatarUrl} alt={item.displayName} />}
            <AvatarFallback className="text-xs">
              {initials(item.displayName)}
            </AvatarFallback>
          </Avatar>
        </StoryRing>
      </button>
      <span className="text-[10px] text-center text-foreground/80 truncate w-full">
        {item.displayName}
      </span>
    </div>
  );
}

/**
 * Ring story ala IG/WA. 1 story = ring penuh. >1 story = ring TERPOTONG jadi
 * segmen (satu busur per story, ada gap antar segmen). allViewed = ring abu.
 *
 * Implementasi: conic-gradient warna ring diselang-seling dengan warna gap
 * (transparan) per segmen. Padding p-[3px] jadi tebal ring; lingkaran dalam
 * (avatar) menutupi bagian tengah.
 */
function StoryRing({
  count,
  viewed,
  children,
}: {
  count: number;
  viewed: boolean;
  children: React.ReactNode;
}) {
  const segments = Math.max(1, count);
  const activeColor = viewed
    ? "rgba(120,120,120,0.7)" // abu (sudah dilihat semua)
    : "#e11d2a"; // merah SOHO
  const gapColor = "transparent";
  const gapDeg = segments > 1 ? 6 : 0; // besar gap antar segmen (derajat)

  const ringStyle: React.CSSProperties =
    segments === 1
      ? { background: activeColor }
      : {
          background: `conic-gradient(${Array.from({ length: segments })
            .map((_, i) => {
              const seg = 360 / segments;
              const start = i * seg + gapDeg / 2;
              const end = (i + 1) * seg - gapDeg / 2;
              return `${gapColor} ${i * seg}deg ${start}deg, ${activeColor} ${start}deg ${end}deg, ${gapColor} ${end}deg ${(i + 1) * seg}deg`;
            })
            .join(", ")})`,
        };

  return (
    <span className="inline-block rounded-full p-[3px]" style={ringStyle}>
      {children}
    </span>
  );
}

/** Bottom sheet: pilih bikin story dari Foto atau Teks. */
function StoryTypePicker({
  onClose,
  onPhoto,
  onText,
}: {
  onClose: () => void;
  onPhoto: () => void;
  onText: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border border-border bg-card p-4 pb-6 sm:pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Create a story</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted/60 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onPhoto}
            className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/20 py-5 transition hover:border-primary/40 hover:bg-muted/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <ImageIcon className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium">Photo</span>
          </button>
          <button
            type="button"
            onClick={onText}
            className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/20 py-5 transition hover:border-primary/40 hover:bg-muted/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Type className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium">Text</span>
          </button>
        </div>
      </div>
    </div>
  );
}
