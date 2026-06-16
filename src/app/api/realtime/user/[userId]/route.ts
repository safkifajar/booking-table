/**
 * SSE endpoint untuk notifikasi in-app per user.
 *
 * URL: GET /api/realtime/user/[userId]
 *
 * Browser (NotificationBell):
 *   const es = new EventSource(`/api/realtime/user/${myId}`);
 *   es.onmessage = () => refetchNotifications();
 *
 * Server: createNotification() → notify(channels.user(profileId)) saat ada
 * notif baru untuk user itu.
 *
 * Authz: hanya boleh subscribe channel DIRI SENDIRI (profile.id === userId).
 * Pola sama dgn session route (heartbeat 25s, cleanup on abort).
 */

import { listener } from "@/lib/realtime/listener";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { channels } from "@/lib/realtime/channels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { userId } = await params;

  const profile = await getCurrentProfile();
  if (!profile) return new Response("Unauthorized", { status: 401 });
  if (profile.id !== userId) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();
  const channel = channels.user(userId);

  let unsubscribe: (() => Promise<void>) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));
      const sub = await listener.listen(channel, (payload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${payload || "{}"}\n\n`));
        } catch {
          // stream closed
        }
      });
      unsubscribe = sub.unlisten;
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 25000);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) await unsubscribe();
    },
  });

  request.signal.addEventListener("abort", () => {
    if (heartbeat) clearInterval(heartbeat);
    if (unsubscribe) void unsubscribe();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
