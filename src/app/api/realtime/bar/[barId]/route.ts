/**
 * SSE endpoint untuk bar realtime (story updates).
 *
 * URL: GET /api/realtime/bar/[barId]
 *
 * Auth: cuma user yang sudah login (no role/membership requirement —
 * story bersifat public di bar).
 *
 * Notify dipanggil dari createStory/deleteStory/markStoryAsViewed via
 * channels.bar(barId).
 *
 * Pattern sama dengan session/staff SSE endpoint (heartbeat 25s, abort
 * cleanup, X-Accel-Buffering off untuk nginx).
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { listener } from "@/lib/realtime/listener";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { channels } from "@/lib/realtime/channels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ barId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { barId } = await params;

  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Validate bar exists
  const [bar] = await db
    .select({ id: bars.id })
    .from(bars)
    .where(eq(bars.id, barId));
  if (!bar) {
    return new Response("Bar not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const channel = channels.bar(barId);

  let unsubscribe: (() => Promise<void>) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));

      const sub = await listener.listen(channel, (payload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${payload || "{}"}\n\n`));
        } catch {
          // closed
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
