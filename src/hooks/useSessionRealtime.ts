"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh session data periodically.
 *
 * Phase 3c: Supabase realtime channel diganti dengan polling 4 detik.
 * Phase 4 nanti ganti dengan SSE endpoint /api/session/[id]/stream untuk
 * instant updates + lebih hemat bandwidth.
 *
 * Trade-off: 4 detik = jelas terasa "agak lag" di UI member-join /
 * order-update, tapi cukup baik untuk demo + tidak butuh tambahan
 * infrastructure.
 */
export function useSessionRealtime(sessionId: string) {
  const router = useRouter();

  React.useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [sessionId, router]);
}
