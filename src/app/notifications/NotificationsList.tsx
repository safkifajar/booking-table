"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Bell, Trash2 } from "lucide-react";
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
import { getActionErrorMessage } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/** Format tanggal+jam langsung, mis. "7 Jul 2026, 14.30" (WIB). */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
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
}: {
  userId: string;
  initial: AdminNotificationRow[];
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
      toast.success("Invitation accepted — you joined the table");
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
      {/* Header aksi */}
      {items.some((x) => !x.read) && (
        <div className="flex justify-end mb-3">
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
        <div className="-mx-4 sm:-mx-6 border-y border-border bg-card overflow-hidden divide-y divide-border">
          {items.map((n) => (
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
          <div className="flex items-start gap-2">
            {!n.read && (
              <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{n.title}</p>
              {n.body && (
                <p className="text-xs text-muted-foreground">{n.body}</p>
              )}
              <p
                className="mt-1 text-[11px] text-muted-foreground/70"
                suppressHydrationWarning
              >
                {formatDateTime(n.created_at)}
              </p>
            </div>
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
