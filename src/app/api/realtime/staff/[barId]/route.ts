/**
 * SSE endpoint untuk staff dashboard realtime.
 *
 * URL: GET /api/realtime/staff/[barId]
 *
 * Auth: hanya staff aktif di bar.
 *
 * Notify dipanggil dari Server Actions yang affect bar:
 * - openTable / closeSession → channels.staff(barId)
 * - addOrderItem / removeOrderItem / markOrderItemStatus → channels.staff(barId)
 * - payShare → channels.staff(barId)
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { staffRoles } from "@/lib/db/schema/extras";
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

  const [staff] = await db
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profile.id),
        eq(staffRoles.barId, barId),
        eq(staffRoles.isActive, true)
      )
    );
  if (!staff) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  const channel = channels.staff(barId);

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
