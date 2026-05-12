"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to realtime changes for a session: members, orders, order_items, payments.
 * On any change, refresh server data via router.refresh().
 *
 * Note: For lower-latency optimistic UI, replace router.refresh() with local state updates.
 * For demo purposes, refresh() is simple and reliable.
 */
export function useSessionRealtime(sessionId: string) {
  const router = useRouter();

  React.useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();

    const log = (...args: unknown[]) =>
      console.log("[Realtime]", `session:${sessionId}`, ...args);

    log("subscribing...");

    const channel = supabase
      .channel(`session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_members",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          log("session_members change", payload.eventType);
          router.refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "table_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          log("table_sessions change", payload.eventType);
          router.refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        (payload) => {
          log("order_items change", payload.eventType);
          router.refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        (payload) => {
          log("payments change", payload.eventType);
          router.refresh();
        }
      )
      .subscribe((status, err) => {
        log("status:", status, err ?? "");
      });

    return () => {
      log("unsubscribing");
      supabase.removeChannel(channel);
    };
  }, [sessionId, router]);
}
