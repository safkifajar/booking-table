"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Loader2,
  Bell,
  Trash2,
  Wallet,
  ArrowRightLeft,
  Clock,
  Sparkles,
  UserPlus,
  ChevronRight,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  type AdminNotificationRow,
} from "@/lib/notifications";
import { acceptInvite, declineInvite } from "@/lib/actions";
import {
  acceptFriendRequest,
  declineFriendRequest,
} from "@/lib/friend-actions";
import { toast } from "sonner";
import { getActionErrorMessage, initials } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/** Jam saja, mis. "14.30" (WIB) — tanggal sudah jadi judul grup. */
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/**
 * Kelompokkan notif PER TANGGAL (bukan label relatif "Kemarin"/"7 hari
 * terakhir" — permintaan user). Urutan mengikuti items (terbaru dulu).
 */
function groupByDate(rows: AdminNotificationRow[]) {
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Jakarta",
    }).format(new Date(iso)); // YYYY-MM-DD (aman diurutkan & dibandingkan)

  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(new Date(iso));

  const groups: { key: string; label: string; items: AdminNotificationRow[] }[] =
    [];
  for (const r of rows) {
    const key = dayKey(r.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, label: dayLabel(r.created_at), items: [r] });
  }
  return groups;
}

/** Lebar tombol hapus yg tersingkap saat digeser (px). */
const REVEAL = 88;

/**
 * Halaman list notifikasi (full-page, ala mobile app). Realtime via SSE
 * /api/realtime/user/<userId>. Notif undangan meja punya tombol Terima/Tolak.
 * Geser item ke kiri → tombol Hapus muncul → klik → konfirmasi dulu.
 */
export function NotificationsList({
  userId,
  initial,
  friendRequestCount = 0,
}: {
  userId: string;
  initial: AdminNotificationRow[];
  /** Jumlah permintaan pertemanan masuk — badge di shortcut paling atas. */
  friendRequestCount?: number;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<AdminNotificationRow[]>(initial);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // Notif yg tombol hapusnya sedang tersingkap (geser). Hanya satu.
  const [openId, setOpenId] = React.useState<string | null>(null);
  // Notif yg menunggu konfirmasi hapus (dialog).
  const [confirmDel, setConfirmDel] = React.useState<AdminNotificationRow | null>(
    null
  );
  const [deleting, setDeleting] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setItems(await getNotifications(50));
  }, []);

  // Realtime: refresh saat ada notif baru.
  React.useEffect(() => {
    const es = new EventSource(`/api/realtime/user/${userId}`);
    es.onmessage = () => void refresh();
    es.onerror = () => {
      /* auto-reconnect by browser */
    };
    return () => es.close();
  }, [userId, refresh]);

  async function handleClickItem(n: AdminNotificationRow) {
    if (!n.read) {
      await markNotificationRead(n.id);
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
    }
    if (n.link) router.push(n.link);
  }

  async function handleMarkAll() {
    await markAllNotificationsRead();
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
  }

  function sessionIdFromLink(link: string | null): string | null {
    if (!link) return null;
    const m = link.match(/\/session\/([0-9a-f-]+)/i);
    return m ? m[1] : null;
  }

  async function handleAccept(n: AdminNotificationRow) {
    const sid = sessionIdFromLink(n.link);
    if (!sid) return;
    setBusyId(n.id);
    try {
      await acceptInvite({ sessionId: sid });
      toast.success("Invitation accepted. You joined the table");
      router.push(n.link!);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to accept invitation"));
    } finally {
      setBusyId(null);
      void refresh();
    }
  }

  async function handleDecline(n: AdminNotificationRow) {
    const sid = sessionIdFromLink(n.link);
    if (!sid) return;
    setBusyId(n.id);
    try {
      await declineInvite({ sessionId: sid });
      toast.success("Invitation declined");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to decline invitation"));
    } finally {
      setBusyId(null);
      void refresh();
    }
  }

  async function handleAcceptFriend(n: AdminNotificationRow) {
    if (!n.ref_id) return;
    setBusyId(n.id);
    try {
      await acceptFriendRequest({ requestId: n.ref_id });
      toast.success("Friend request accepted");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to accept request"));
    } finally {
      setBusyId(null);
      void refresh();
    }
  }

  async function handleDeclineFriend(n: AdminNotificationRow) {
    if (!n.ref_id) return;
    setBusyId(n.id);
    try {
      await declineFriendRequest({ requestId: n.ref_id });
      toast.success("Friend request declined");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to decline request"));
    } finally {
      setBusyId(null);
      void refresh();
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDel) return;
    const id = confirmDel.id;
    setDeleting(true);
    // Optimistic: hapus dari layar dulu.
    const prev = items;
    setItems((list) => list.filter((x) => x.id !== id));
    setOpenId(null);
    try {
      await deleteNotification(id);
      toast.success("Notification deleted");
    } catch (err) {
      setItems(prev); // rollback
      toast.error(getActionErrorMessage(err, "Failed to delete notification"));
    } finally {
      setDeleting(false);
      setConfirmDel(null);
    }
  }

  return (
    <div>
      {/* Shortcut ke permintaan pertemanan (ala IG "Permintaan mengikuti") */}
      {friendRequestCount > 0 && (
        <Link
          href="/profile/friends?tab=requests"
          className="-mx-4 sm:-mx-6 flex items-center gap-3 border-b border-border bg-card px-4 py-3 transition hover:bg-muted/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
            <UserPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Friend requests</p>
            <p className="text-xs text-muted-foreground">
              {friendRequestCount} request{friendRequestCount === 1 ? "" : "s"}{" "}
              waiting for you
            </p>
          </div>
          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
            {friendRequestCount}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        </Link>
      )}

      {/* Header aksi */}
      {items.some((x) => !x.read) && (
        <div className="flex justify-end my-3">
          <button
            type="button"
            onClick={handleMarkAll}
            className="text-xs text-primary hover:underline"
          >
            Mark all as read
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Bell className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">No notifications yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Invitations & updates will show up here.
          </p>
        </div>
      ) : (
        // Dikelompokkan PER TANGGAL (tanpa label relatif "Kemarin"/"7 hari").
        groupByDate(items).map((group) => (
          <div key={group.key} className="mb-4 last:mb-0">
            <p className="px-1 pb-2 text-xs font-semibold text-muted-foreground">
              {group.label}
            </p>
            <div className="-mx-4 sm:-mx-6 border-y border-border bg-card overflow-hidden divide-y divide-border">
              {group.items.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  busyId={busyId}
                  revealed={openId === n.id}
                  onReveal={(open) => setOpenId(open ? n.id : null)}
                  onClickItem={handleClickItem}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                  onAcceptFriend={handleAcceptFriend}
                  onDeclineFriend={handleDeclineFriend}
                  onAskDelete={(row) => setConfirmDel(row)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Dialog konfirmasi hapus */}
      <Dialog
        open={confirmDel !== null}
        onOpenChange={(o) => {
          if (!o && !deleting) setConfirmDel(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete notification?</DialogTitle>
            <DialogDescription>
              This notification will be removed permanently. This can&apos;t be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setConfirmDel(null)}
              className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleConfirmDelete}
              className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Satu baris notifikasi + swipe-to-reveal tombol Hapus. Geser konten ke kiri
 * (pointer/touch) → tombol Hapus merah di belakang tersingkap. Tap konten saat
 * tersingkap → tutup lagi (tidak navigasi).
 */
function NotificationItem({
  n,
  busyId,
  revealed,
  onReveal,
  onClickItem,
  onAccept,
  onDecline,
  onAcceptFriend,
  onDeclineFriend,
  onAskDelete,
}: {
  n: AdminNotificationRow;
  busyId: string | null;
  revealed: boolean;
  onReveal: (open: boolean) => void;
  onClickItem: (n: AdminNotificationRow) => void;
  onAccept: (n: AdminNotificationRow) => void;
  onDecline: (n: AdminNotificationRow) => void;
  onAcceptFriend: (n: AdminNotificationRow) => void;
  onDeclineFriend: (n: AdminNotificationRow) => void;
  onAskDelete: (n: AdminNotificationRow) => void;
}) {
  // Offset geser LIVE selama jari menyeret (null = tidak sedang menyeret →
  // posisi ditentukan `revealed`). Dengan begini tak perlu useEffect sinkron.
  const [drag, setDrag] = React.useState<number | null>(null);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const dragging = React.useRef(false);
  const moved = React.useRef(false);

  // Offset tampilan: pakai nilai drag kalau sedang menyeret, kalau tidak ikut
  // status revealed (0 tertutup, -REVEAL terbuka).
  const dx = drag ?? (revealed ? -REVEAL : 0);

  const isPendingInvite = n.type === "table_invite" && !n.responded;
  const isPendingFriendReq =
    n.type === "friend_request" && !n.responded && n.ref_id != null;
  const respondedOutcome =
    n.responded && n.type === "invite_accepted"
      ? "accepted"
      : n.responded && n.type === "invite_rejected"
        ? "rejected"
        : n.type === "invite_cancelled"
          ? "cancelled"
          : n.responded && n.type === "table_invite"
            ? "done"
            : null;

  function onPointerDown(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY };
    dragging.current = true;
    moved.current = false;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || !start.current) return;
    const deltaX = e.clientX - start.current.x;
    const deltaY = e.clientY - start.current.y;
    // Abaikan kalau gerakan lebih dominan vertikal (biar scroll tetap jalan).
    if (Math.abs(deltaY) > Math.abs(deltaX) && !moved.current) return;
    if (Math.abs(deltaX) > 6) moved.current = true;
    // Basis = posisi awal (0 kalau tertutup, -REVEAL kalau tersingkap).
    const base = revealed ? -REVEAL : 0;
    setDrag(Math.min(0, Math.max(-REVEAL, base + deltaX)));
  }
  function onPointerUp() {
    dragging.current = false;
    if (!start.current) return;
    start.current = null;
    // Snap: lewat separuh → buka penuh, kalau tidak → tutup.
    const cur = drag ?? (revealed ? -REVEAL : 0);
    onReveal(cur <= -REVEAL / 2);
    setDrag(null); // lepas kendali live → ikut `revealed`
  }

  // Lebar area tersingkap = seberapa jauh digeser (0 saat tertutup). Tombol
  // hidup di dalam area ini saja → saat tertutup lebar 0 = tak terlihat sama
  // sekali (termasuk tepi atas/bawah). overflow-hidden meng-clip isinya.
  const revealW = Math.min(REVEAL, -dx);

  return (
    <div className="relative overflow-hidden">
      {/* Tombol Hapus di belakang (tersingkap saat geser) */}
      <div
        className="absolute inset-y-0 right-0 overflow-hidden"
        style={{ width: revealW }}
        aria-hidden={revealW === 0}
      >
        <button
          type="button"
          aria-label="Delete notification"
          onClick={() => onAskDelete(n)}
          className="absolute inset-y-0 right-0 flex items-center justify-center gap-1 bg-destructive text-destructive-foreground text-xs font-medium"
          style={{ width: REVEAL }}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>

      {/* Konten notif (geser di atas tombol) */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translateX(${dx}px)`,
          transition: drag !== null ? "none" : "transform 0.2s ease",
          touchAction: "pan-y",
        }}
        className="relative bg-card px-4 py-3"
      >
        {/* Tint unread — overlay di atas bg-card SOLID (jangan pakai bg semi-
            transparan langsung di kontainer, nanti tombol merah tembus). */}
        {!n.read && (
          <span className="pointer-events-none absolute inset-0 bg-primary/[0.06]" />
        )}
        <button
          type="button"
          onClick={() => {
            // Kalau sedang tersingkap → tap menutup (bukan navigasi). Kalau baru
            // saja digeser → jangan navigasi.
            if (revealed) {
              onReveal(false);
              return;
            }
            if (moved.current) return;
            onClickItem(n);
          }}
          className="w-full text-left"
        >
          <div className="flex items-start gap-3">
            {/* Foto pengirim (mention/repost/friend/invite) atau ikon jenis
                untuk notif sistem (pembayaran/booking). */}
            <NotifAvatar n={n} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{n.title}</p>
              {n.body && (
                <p className="text-xs text-muted-foreground">{n.body}</p>
              )}
              <p
                className="mt-1 text-[11px] text-muted-foreground/70"
                suppressHydrationWarning
              >
                {formatTime(n.created_at)}
              </p>
            </div>
            {!n.read && (
              <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
            )}
          </div>
        </button>
        {isPendingInvite && (
          <div className="flex gap-2 mt-2 pl-4">
            <button
              type="button"
              disabled={busyId === n.id}
              onClick={() => onAccept(n)}
              className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {busyId === n.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Accept
            </button>
            <button
              type="button"
              disabled={busyId === n.id}
              onClick={() => onDecline(n)}
              className="flex-1 h-9 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        )}
        {isPendingFriendReq && (
          <div className="flex gap-2 mt-2 pl-4">
            <button
              type="button"
              disabled={busyId === n.id}
              onClick={() => onAcceptFriend(n)}
              className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {busyId === n.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Accept
            </button>
            <button
              type="button"
              disabled={busyId === n.id}
              onClick={() => onDeclineFriend(n)}
              className="flex-1 h-9 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        )}
        {n.type === "friend_request" && n.responded && (
          <p className="mt-2 pl-4 text-xs text-muted-foreground flex items-center gap-1">
            <Check className="h-3 w-3" />
            You responded to this request
          </p>
        )}
        {respondedOutcome === "accepted" && (
          <p className="mt-2 pl-4 text-xs text-emerald-500 flex items-center gap-1">
            <Check className="h-3 w-3" />
            You accepted this invitation
          </p>
        )}
        {respondedOutcome === "rejected" && (
          <p className="mt-2 pl-4 text-xs text-muted-foreground flex items-center gap-1">
            <X className="h-3 w-3" />
            You declined this invitation
          </p>
        )}
        {respondedOutcome === "cancelled" && (
          <p className="mt-2 pl-4 text-xs text-muted-foreground flex items-center gap-1">
            <X className="h-3 w-3" />
            Invitation cancelled by host
          </p>
        )}
        {respondedOutcome === "done" && (
          <p className="mt-2 pl-4 text-xs text-muted-foreground flex items-center gap-1">
            <Check className="h-3 w-3" />
            Invitation already responded to
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Gambar di kiri baris notifikasi:
 * - Notif dari ORANG (mention, repost, friend, undangan) → foto profilnya.
 * - Notif SISTEM (pembayaran, booking, dll) → ikon berwarna sesuai jenis.
 */
function NotifAvatar({ n }: { n: AdminNotificationRow }) {
  // Ada aktor → tampilkan fotonya (fallback inisial nama).
  if (n.actor_id) {
    return (
      <Avatar className="h-10 w-10 shrink-0">
        {n.actor_avatar_url && (
          <AvatarImage
            src={n.actor_avatar_url}
            alt={n.actor_name ?? "User"}
          />
        )}
        <AvatarFallback className="text-xs">
          {initials(n.actor_name ?? "?")}
        </AvatarFallback>
      </Avatar>
    );
  }

  // Notif sistem → ikon + warna per jenis.
  const style: Record<string, { icon: React.ReactNode; cls: string }> = {
    payment_received: {
      icon: <Wallet className="h-5 w-5" />,
      cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    },
    payment_cancelled: {
      icon: <Wallet className="h-5 w-5" />,
      cls: "bg-red-500/15 text-red-400 border-red-500/30",
    },
    move_request: {
      icon: <ArrowRightLeft className="h-5 w-5" />,
      cls: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    },
    move_approved: {
      icon: <ArrowRightLeft className="h-5 w-5" />,
      cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    },
    move_rejected: {
      icon: <ArrowRightLeft className="h-5 w-5" />,
      cls: "bg-red-500/15 text-red-400 border-red-500/30",
    },
    // Pengingat menjelang jam booking — ikon jam, warna primary supaya
    // menonjol di antara notif lain (tamu perlu segera berangkat).
    booking_reminder: {
      icon: <Clock className="h-5 w-5" />,
      cls: "bg-primary/15 text-primary border-primary/30",
    },
    // Promo/event baru mulai tayang.
    promo_new: {
      icon: <Sparkles className="h-5 w-5" />,
      cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
  };
  const s = style[n.type] ?? {
    icon: <Bell className="h-5 w-5" />,
    cls: "bg-muted text-muted-foreground border-border",
  };

  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${s.cls}`}
    >
      {s.icon}
    </span>
  );
}
