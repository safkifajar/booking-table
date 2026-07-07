"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getUnreadCount } from "@/lib/notifications";

/**
 * Bell notifikasi in-app — sekarang jadi TOMBOL yang menuju halaman
 * /notifications (list rapih ala mobile app), bukan dropdown popup lagi.
 * Badge jumlah unread tetap realtime via SSE /api/realtime/user/<userId>.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const [unread, setUnread] = React.useState(0);

  // Initial unread count + subscribe SSE (badge realtime).
  React.useEffect(() => {
    void getUnreadCount().then(setUnread);
    const es = new EventSource(`/api/realtime/user/${userId}`);
    es.onmessage = () => {
      void getUnreadCount().then(setUnread);
    };
    es.onerror = () => {
      /* auto-reconnect by browser */
    };
    return () => es.close();
  }, [userId]);

  return (
    <Link
      href="/notifications"
      className="relative h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted/60 transition text-muted-foreground hover:text-foreground"
      aria-label="Notifications"
    >
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
