/**
 * SSE endpoint untuk session realtime.
 *
 * URL: GET /api/realtime/session/[id]
 *
 * Browser pakai via:
 *   const es = new EventSource(`/api/realtime/session/${id}`);
 *   es.onmessage = () => router.refresh();
 *
 * Wire-up dari side server (Server Actions): panggil `notify(channels.session(id), {...})`
 * setelah commit perubahan member/order/item/payment.
 *
 * Auth: cek auth + verify user adalah session member sebelum subscribe.
 * Mencegah eavesdrop ke session orang lain.
 *
 * Lifecycle:
 * 1. Browser open EventSource → handler subscribe channel
 * 2. Tiap notify masuk → tulis "data: <json>\n\n" ke stream
 * 3. Browser close (tab/navigate) → abort signal trigger unsubscribe
 * 4. Heartbeat "comment line" tiap 25s biar reverse proxy tidak idle-disconnect
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { staffRoles } from "@/lib/db/schema/extras";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { listener } from "@/lib/realtime/listener";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { channels } from "@/lib/realtime/channels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id: sessionId } = await params;

  // Auth guard
  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Authz: user must be host, joined member, atau staff di bar
  const allowed = await canAccessSession(sessionId, profile.id);
  if (!allowed) {
    return new Response("Forbidden", { status: 403 });
  }

  // Create SSE response
  const encoder = new TextEncoder();
  const channel = channels.session(sessionId);

  let unsubscribe: (() => Promise<void>) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Initial event — confirm subscription
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));

      // Subscribe to Postgres NOTIFY
      const sub = await listener.listen(channel, (payload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${payload || "{}"}\n\n`));
        } catch {
          // Stream closed by client — ignore
        }
      });
      unsubscribe = sub.unlisten;

      // Heartbeat tiap 25s — comment line (no event) supaya proxy tidak timeout
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // Stream closed — clear interval
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 25000);
    },
    async cancel() {
      // Browser closed connection — cleanup
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) await unsubscribe();
    },
  });

  // Handle abort signal (browser navigates away)
  request.signal.addEventListener("abort", () => {
    if (heartbeat) clearInterval(heartbeat);
    if (unsubscribe) void unsubscribe();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable nginx buffering — penting untuk SSE
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Boleh subscribe SSE kalau:
 * - User adalah host session
 * - User adalah joined/pending member
 * - User adalah staff aktif di bar yang punya session ini
 */
async function canAccessSession(sessionId: string, profileId: string): Promise<boolean> {
  // 1. Cek host atau member
  const [sessionRow] = await db
    .select({
      host_id: tableSessions.hostId,
      bar_id: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));
  if (!sessionRow) return false;
  if (sessionRow.host_id === profileId) return true;

  const [member] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profileId)
      )
    );
  if (member) return true;

  // 2. Cek staff di bar
  const [staff] = await db
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profileId),
        eq(staffRoles.barId, sessionRow.bar_id),
        eq(staffRoles.isActive, true)
      )
    );
  return !!staff;
}
