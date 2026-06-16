"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  type AdminNotificationRow,
} from "@/lib/notifications";
import {
  acceptInvite,
  declineInvite,
} from "@/lib/actions";
import { toast } from "sonner";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Bell notifikasi in-app + dropdown list. Realtime via SSE
 * /api/realtime/user/<userId>. Notif tipe table_invite punya tombol
 * Terima/Tolak (accept/decline undangan meja).
 */
export function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<AdminNotificationRow[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const [list, n] = await Promise.all([getNotifications(20), getUnreadCount()]);
    setItems(list);
    setUnread(n);
  }, []);

  // Initial unread count + subscribe SSE.
  React.useEffect(() => {
    void getUnreadCount().then(setUnread);
    const es = new EventSource(`/api/realtime/user/${userId}`);
    es.onmessage = () => {
      void getUnreadCount().then(setUnread);
      // kalau dropdown terbuka, refresh list juga
      setOpen((isOpen) => {
        if (isOpen) void refresh();
        return isOpen;
      });
    };
    es.onerror = () => {
      /* auto-reconnect by browser */
    };
    return () => es.close();
  }, [userId, refresh]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  }

  async function handleClickItem(n: AdminNotificationRow) {
    if (!n.read) {
      await markNotificationRead(n.id);
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }

  async function handleMarkAll() {
    await markAllNotificationsRead();
    setUnread(0);
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
  }

  // Accept/decline undangan meja. link notif = /session/<id>.
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
      await markNotificationRead(n.id);
      toast.success("Undangan diterima — kamu bergabung ke meja");
      setOpen(false);
      router.push(n.link!);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal terima undangan"));
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
      await markNotificationRead(n.id);
      toast.success("Undangan ditolak");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal tolak undangan"));
    } finally {
      setBusyId(null);
      void refresh();
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted/60 transition text-muted-foreground hover:text-foreground"
        aria-label="Notifikasi"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-2 w-80 max-w-[90vw] z-50 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-sm font-semibold">Notifikasi</span>
              {items.some((x) => !x.read) && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="text-xs text-primary hover:underline"
                >
                  Tandai semua dibaca
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-border">
              {loading ? (
                <div className="p-6 text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Belum ada notifikasi.
                </p>
              ) : (
                items.map((n) => {
                  const isInvite = n.type === "table_invite";
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        "px-3 py-2.5",
                        !n.read && "bg-primary/[0.06]"
                      )}
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
                          </div>
                        </div>
                      </button>
                      {isInvite && (
                        <div className="flex gap-2 mt-2 pl-4">
                          <button
                            type="button"
                            disabled={busyId === n.id}
                            onClick={() => handleAccept(n)}
                            className="flex-1 h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            {busyId === n.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            Terima
                          </button>
                          <button
                            type="button"
                            disabled={busyId === n.id}
                            onClick={() => handleDecline(n)}
                            className="flex-1 h-8 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            Tolak
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
