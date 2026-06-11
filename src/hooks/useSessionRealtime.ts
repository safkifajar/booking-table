"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribe ke SSE endpoint untuk session realtime updates.
 *
 * Endpoint: /api/realtime/session/[id] (lihat src/app/api/realtime/session/[id]/route.ts)
 *
 * Server Actions yang affect session call `notify(channels.session(id))` setelah
 * commit → Postgres NOTIFY → SSE endpoint stream → EventSource onmessage →
 * router.refresh() trigger server re-fetch + page re-render.
 *
 * Migrated dari Supabase Realtime channel (Phase 3c sempat fallback polling 4s).
 *
 * Reconnect: EventSource auto-reconnect by browser default (3-5s delay).
 * Heartbeat dari server tiap 25s mencegah idle disconnect di reverse proxy.
 */
export function useSessionRealtime(sessionId: string) {
  const router = useRouter();

  React.useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`/api/realtime/session/${sessionId}`);

    es.addEventListener("ready", () => {
      // Connected — server akan stream notifications dari sini
    });

    es.onmessage = () => {
      router.refresh();
    };

    es.onerror = () => {
      // EventSource auto-reconnect — log untuk debugging
      // (jangan close, biarkan browser retry)
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] session:${sessionId} disconnected, retrying...`);
      }
    };

    return () => {
      es.close();
    };
  }, [sessionId, router]);
}
