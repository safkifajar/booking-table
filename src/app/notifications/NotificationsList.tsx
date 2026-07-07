"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AdminNotificationRow,
} from "@/lib/notifications";
import { acceptInvite, declineInvite } from "@/lib/actions";
import { toast } from "sonner";
import { getActionErrorMessage } from "@/lib/utils";

/** Format tanggal+jam langsung, mis. "7 Jul 2026, 14.30" (WIB). */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/**
 * Halaman list notifikasi (full-page, ala mobile app). Realtime via SSE
 * /api/realtime/user/<userId>. Notif undangan meja punya tombol Terima/Tolak.
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
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {items.map((n) => {
            const isPendingInvite =
              n.type === "table_invite" && !n.responded;
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
            return (
              <div
                key={n.id}
                className={cn("px-4 py-3", !n.read && "bg-primary/[0.06]")}
              >
                <button
                  type="button"
                  onClick={() => handleClickItem(n)}
                  className="w-full text-left"
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground">
                          {n.body}
                        </p>
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
                      onClick={() => handleAccept(n)}
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
                      onClick={() => handleDecline(n)}
                      className="flex-1 h-9 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
