"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, ChevronLeft, ChevronRight, MapPin, Eye, Trash2 } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  markStoryAsViewed,
  deleteStory,
  getStoriesForUser,
  getStoryViewers,
  type StoryDetail,
  type StoryViewer as ViewerEntry,
} from "@/lib/story-actions";
import { getActionErrorMessage, initials, cn } from "@/lib/utils";
import { STORY_TEXT_STYLE_CLASS } from "@/lib/story-constants";

/** Info profil ringkas pembuat story (untuk header). */
export interface StoryUserMeta {
  displayName: string;
  avatarUrl: string | null;
}

interface Props {
  barId: string;
  /** UserId yang stories-nya pertama mau dilihat */
  startUserId: string;
  /** UserId yang lagi login (untuk owner check) */
  viewerId: string;
  /** Urutan user yang punya story aktif — untuk navigasi antar user */
  orderedUserIds: string[];
  /** Map userId → {displayName, avatarUrl} untuk header pembuat story. */
  userMeta: Record<string, StoryUserMeta>;
  onClose: () => void;
}

const SLIDE_DURATION_MS = 5000;

type Phase = "loading" | "viewing" | "viewers";

/**
 * Full-screen story viewer.
 *
 * Navigasi:
 * - Tap kanan / arrow right → next story (atau next user kalau di akhir)
 * - Tap kiri / arrow left → prev story (atau prev user)
 * - ESC / klik tombol X → close
 * - Klik area atas → tampilkan list viewers (kalau owner)
 *
 * Auto-advance: 5 detik per story dengan progress bar di atas.
 * Pause saat caption diketuk panjang (long-press untuk pause future).
 */
export function StoryViewer({
  barId,
  startUserId,
  viewerId,
  orderedUserIds,
  userMeta,
  onClose,
}: Props) {
  const confirm = useConfirm();
  const router = useRouter();

  // Buka halaman profil user (pembuat story / viewer). Tutup viewer dulu supaya
  // tak menutupi halaman tujuan.
  const goToProfile = React.useCallback(
    (userId: string) => {
      onClose();
      router.push(`/network/${userId}`);
    },
    [onClose, router]
  );

  const [currentUserId, setCurrentUserId] = React.useState(startUserId);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [stories, setStories] = React.useState<StoryDetail[]>([]);
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [progress, setProgress] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [viewers, setViewers] = React.useState<ViewerEntry[] | null>(null);
  const [showViewers, setShowViewers] = React.useState(false);

  const currentStory = stories[currentIndex];
  const isOwner = currentStory?.id && currentUserId === viewerId;
  const userIndex = orderedUserIds.indexOf(currentUserId);
  const hasNextUser = userIndex < orderedUserIds.length - 1;
  const hasPrevUser = userIndex > 0;

  // Load stories tiap kali ganti user
  React.useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setProgress(0);
    setCurrentIndex(0);
    getStoriesForUser(currentUserId, barId, viewerId).then((rows) => {
      if (cancelled) return;
      if (rows.length === 0) {
        // No stories untuk user ini (race condition kalau expire)
        if (hasNextUser) {
          setCurrentUserId(orderedUserIds[userIndex + 1]);
        } else {
          onClose();
        }
        return;
      }
      setStories(rows);
      setPhase("viewing");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, barId, viewerId]);

  // Mark current as viewed (after small delay supaya gak spam saat skip cepat)
  React.useEffect(() => {
    if (!currentStory || isOwner) return;
    const t = setTimeout(() => {
      markStoryAsViewed(currentStory.id).catch(() => {
        // ignore — view tracking best-effort
      });
    }, 500);
    return () => clearTimeout(t);
  }, [currentStory, isOwner]);

  // Navigasi prev/next — dideklarasi SEBELUM effect yg memakainya (auto-advance
  // & keyboard) supaya tidak "used before declared".
  const goNext = React.useCallback(() => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex((i) => i + 1);
      setProgress(0);
    } else if (hasNextUser) {
      setCurrentUserId(orderedUserIds[userIndex + 1]);
    } else {
      onClose();
    }
  }, [currentIndex, stories.length, hasNextUser, orderedUserIds, userIndex, onClose]);

  const goPrev = React.useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setProgress(0);
    } else if (hasPrevUser) {
      setCurrentUserId(orderedUserIds[userIndex - 1]);
    }
  }, [currentIndex, hasPrevUser, orderedUserIds, userIndex]);

  // Auto-advance progress. `goNext` MASUK deps: kalau di-exclude, timer memakai
  // goNext versi lama (stale) → saat pindah antar-user, hasNextUser/userIndex
  // stale → salah anggap "user terakhir" → viewer nutup padahal masih ada user
  // berikutnya. Dengan goNext di deps (ia useCallback), timer selalu pakai
  // versi terbaru.
  React.useEffect(() => {
    if (phase !== "viewing" || paused || showViewers) return;
    const startTime = Date.now() - progress * SLIDE_DURATION_MS;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / SLIDE_DURATION_MS;
      if (elapsed >= 1) {
        setProgress(0);
        goNext();
      } else {
        setProgress(elapsed);
      }
    }, 50);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex, paused, showViewers, goNext]);

  // ESC to close
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showViewers) setShowViewers(false);
        else onClose();
      } else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showViewers, goNext, goPrev, onClose]);

  // Bedakan tap cepat (navigasi) vs tahan (pause). Tekan ≥ LONG_PRESS_MS =
  // long-press → pause selama ditahan, lepas → lanjut TANPA navigasi.
  const LONG_PRESS_MS = 200;
  const pressStart = React.useRef<number>(0);
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function onPressStart() {
    pressStart.current = Date.now();
    // Pause baru aktif kalau ditahan ≥ threshold (biar tap cepat tidak kedip).
    pressTimer.current = setTimeout(() => setPaused(true), LONG_PRESS_MS);
  }

  function onPressEnd(dir: "prev" | "next") {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    const held = Date.now() - pressStart.current;
    setPaused(false);
    // Tahan lama = pause (sudah resume di atas), JANGAN navigasi.
    if (held < LONG_PRESS_MS) {
      if (dir === "prev") goPrev();
      else goNext();
    }
  }

  // Jari keluar dari zona (mis. geser saat tap) → HANYA batalkan pause/timer,
  // JANGAN navigasi. Kalau pointerLeave ikut memanggil onPressEnd, tap bisa
  // memicu goNext DUA kali (pointerUp + pointerLeave) → skip 2 story → lewat
  // batas → viewer nutup. Ini yang bikin "next malah close".
  function onPressCancel() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    setPaused(false);
  }

  async function handleDelete() {
    if (!currentStory) return;
    // Pause story (auto-advance + progress) selama dialog konfirmasi terbuka.
    setPaused(true);
    const ok = await confirm({
      title: "Delete this story?",
      description: "The story will disappear for all viewers and cannot be restored.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) {
      // Batal → lanjutkan story dari posisi semula.
      setPaused(false);
      return;
    }

    try {
      await deleteStory(currentStory.id);
      toast.success("Story deleted");
      // Remove dari list local
      setStories((arr) => arr.filter((s) => s.id !== currentStory.id));
      // Kalau habis, lompat ke user berikutnya / close
      if (stories.length === 1) {
        if (hasNextUser) setCurrentUserId(orderedUserIds[userIndex + 1]);
        else onClose();
      } else if (currentIndex >= stories.length - 1) {
        setCurrentIndex((i) => Math.max(0, i - 1));
      }
      // Lanjutkan auto-advance utk story berikutnya.
      setPaused(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to delete story"));
      // Gagal hapus → story tetap ada, lanjutkan.
      setPaused(false);
    }
  }

  async function handleShowViewers() {
    if (!currentStory || !isOwner) return;
    setShowViewers(true);
    setPaused(true);
    if (!viewers) {
      try {
        const rows = await getStoryViewers(currentStory.id);
        setViewers(rows);
      } catch {
        toast.error("Failed to load viewers");
      }
    }
  }

  if (phase === "loading") {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="text-white/40 text-sm">Loading...</div>
      </div>
    );
  }

  if (!currentStory) {
    return null;
  }

  const timeAgo = formatStoryAge(currentStory.createdAt);
  const creator = userMeta[currentUserId];

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <div className="relative w-full h-full max-w-md mx-auto bg-zinc-950 overflow-hidden">
        {/* Media: foto ATAU story teks (latar warna + teks tengah). */}
        {currentStory.kind === "text" ? (
          <div
            className="absolute inset-0 flex items-center justify-center px-8"
            style={{ backgroundColor: currentStory.bgColor ?? "#0f172a" }}
          >
            <MentionText
              text={currentStory.caption ?? ""}
              mentions={currentStory.mentionedUsers}
              onMentionClick={goToProfile}
              className={cn(
                "text-center text-2xl leading-snug text-white whitespace-pre-line break-words drop-shadow-sm",
                STORY_TEXT_STYLE_CLASS[currentStory.textStyle] ??
                  STORY_TEXT_STYLE_CLASS.classic
              )}
            />
          </div>
        ) : (
          currentStory.imageUrl && (
            <Image
              src={currentStory.imageUrl}
              alt="Story"
              fill
              className="object-contain"
              unoptimized
              priority
            />
          )
        )}

        {/* Tap zones (kiri/kanan). Tap cepat → prev/next; tahan → pause. */}
        <button
          type="button"
          onPointerDown={onPressStart}
          onPointerUp={() => onPressEnd("prev")}
          onPointerLeave={onPressCancel}
          className="absolute inset-y-0 left-0 w-1/3 group flex items-center pl-2 touch-none select-none"
          aria-label="Previous story"
        >
          <span className="opacity-0 group-hover:opacity-60 transition">
            <ChevronLeft className="h-6 w-6 text-white" />
          </span>
        </button>
        <button
          type="button"
          onPointerDown={onPressStart}
          onPointerUp={() => onPressEnd("next")}
          onPointerLeave={onPressCancel}
          className="absolute inset-y-0 right-0 w-1/3 group flex items-center justify-end pr-2 touch-none select-none"
          aria-label="Next story"
        >
          <span className="opacity-0 group-hover:opacity-60 transition">
            <ChevronRight className="h-6 w-6 text-white" />
          </span>
        </button>
        {/* Zona tengah: tahan untuk pause (tap cepat tidak navigasi). */}
        <button
          type="button"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          className="absolute inset-y-0 left-1/3 w-1/3 touch-none select-none"
          aria-label="Hold to pause"
        />

        {/* Progress bars */}
        <div className="absolute top-0 inset-x-0 px-2 pt-2 flex gap-1 pointer-events-none">
          {stories.map((_, idx) => (
            <div
              key={idx}
              className="flex-1 h-1 rounded-full bg-white/30 overflow-hidden"
            >
              <div
                className="h-full bg-white transition-all"
                style={{
                  width:
                    idx < currentIndex
                      ? "100%"
                      : idx === currentIndex
                        ? `${progress * 100}%`
                        : "0%",
                  transitionDuration: idx === currentIndex ? "50ms" : "0ms",
                }}
              />
            </div>
          ))}
        </div>

        {/* Top bar (profil pembuat + waktu + close) */}
        <div className="absolute top-4 inset-x-0 px-4 flex items-center justify-between gap-2 pointer-events-none">
          {/* Profil pembuat — klik ke halaman profil user */}
          <button
            type="button"
            onClick={() => goToProfile(currentUserId)}
            className="flex items-center gap-2 min-w-0 pointer-events-auto rounded-full pr-2 hover:bg-white/10 transition"
            aria-label={`View ${creator?.displayName ?? "user"}'s profile`}
          >
            <Avatar className="h-8 w-8 ring-2 ring-white/20 shrink-0">
              {creator?.avatarUrl && (
                <AvatarImage src={creator.avatarUrl} alt={creator.displayName} />
              )}
              <AvatarFallback className="text-[10px]">
                {initials(creator?.displayName ?? "?")}
              </AvatarFallback>
            </Avatar>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-white truncate">
                {creator?.displayName ?? "User"}
              </span>
              <span className="text-xs text-white/60 shrink-0">{timeAgo}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-white/10 transition pointer-events-auto shrink-0"
            aria-label="Close story"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* Bottom area: caption + table tag + actions */}
        <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
          <div className="space-y-2 max-w-sm pointer-events-auto">
            {currentStory.table_label && (
              <div className="inline-flex items-center gap-1 text-[11px] text-white/80 bg-white/10 px-2 py-0.5 rounded-full">
                <MapPin className="h-3 w-3" />
                {currentStory.table_label} · {currentStory.area_name}
              </div>
            )}
            {currentStory.kind !== "text" && currentStory.caption && (
              <MentionText
                text={currentStory.caption}
                mentions={currentStory.mentionedUsers}
                onMentionClick={goToProfile}
                className="block text-sm text-white whitespace-pre-line"
              />
            )}
            {isOwner && (
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleShowViewers}
                  className="flex items-center gap-1.5 text-xs text-white/90 hover:text-white transition"
                >
                  <Eye className="h-4 w-4" />
                  {currentStory.viewCount > 0
                    ? `${currentStory.viewCount} viewers`
                    : "View viewers"}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition ml-auto"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Viewers overlay */}
        {showViewers && (
          <ViewersPanel
            viewers={viewers}
            onViewerClick={goToProfile}
            onClose={() => {
              setShowViewers(false);
              setPaused(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function ViewersPanel({
  viewers,
  onViewerClick,
  onClose,
}: {
  viewers: ViewerEntry[] | null;
  onViewerClick: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 max-h-[60%] bg-zinc-900 border-t border-white/10 rounded-t-2xl flex flex-col">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Viewers {viewers && `(${viewers.length})`}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-white/10 transition"
          aria-label="Close viewer list"
        >
          <X className="h-4 w-4 text-white" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {viewers === null ? (
          <div className="text-white/40 text-sm text-center py-6">Loading...</div>
        ) : viewers.length === 0 ? (
          <div className="text-white/40 text-sm text-center py-6">
            No views yet
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {viewers.map((v) => (
              <button
                key={v.profileId}
                type="button"
                onClick={() => onViewerClick(v.profileId)}
                className="flex items-center gap-3 py-2.5 w-full text-left hover:bg-white/5 -mx-4 px-4 transition"
              >
                <Avatar className="h-8 w-8">
                  {v.avatarUrl && (
                    <AvatarImage src={v.avatarUrl} alt={v.displayName} />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {initials(v.displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {v.displayName}
                  </div>
                  <div className="text-[10px] text-white/40">
                    {formatViewedAt(v.viewedAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Umur story singkat (baru / Nm / Nj). Module-scope: Date.now di luar render. */
function formatStoryAge(createdAt: Date): string {
  const m = Math.floor((Date.now() - createdAt.getTime()) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/**
 * Waktu lihat story di panel viewers. < 1 jam → relatif ("baru saja" / "N menit
 * lalu"). ≥ 1 jam → tampilkan JAM (mis. "19:30"), atau tanggal + jam kalau beda
 * hari — biar owner tahu kapan persisnya dilihat, bukan cuma "5 jam lalu".
 */
function formatViewedAt(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  // ≥ 1 jam → jam:menit. Kalau bukan hari ini, tambahkan tanggal singkat.
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  const time = date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return time;
  const day = date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
  return `${day}, ${time}`;
}

/**
 * Render teks story dengan @username ter-highlight. Handle yang cocok dgn
 * mentionedUsers jadi tautan ke profil; sisanya teks biasa. Case-insensitive.
 */
function MentionText({
  text,
  mentions,
  className,
  onMentionClick,
}: {
  text: string;
  mentions: { id: string; username: string }[];
  className?: string;
  onMentionClick: (userId: string) => void;
}) {
  if (mentions.length === 0) {
    return <span className={className}>{text}</span>;
  }
  const byHandle = new Map(mentions.map((m) => [m.username.toLowerCase(), m.id]));
  const parts = text.split(/(@[a-z0-9_]{3,20})/gi);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        const m = /^@([a-z0-9_]{3,20})$/i.exec(part);
        const uid = m ? byHandle.get(m[1].toLowerCase()) : undefined;
        if (uid) {
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMentionClick(uid);
              }}
              className="font-semibold text-sky-300 hover:underline"
            >
              {part}
            </button>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}
