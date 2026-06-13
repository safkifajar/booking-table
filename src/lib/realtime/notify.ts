"use server";

/**
 * Trigger Postgres NOTIFY untuk channel tertentu (Server Action helper).
 *
 * Constraint: file dengan "use server" cuma boleh export async functions.
 * Channel naming constants di-export dari `channels.ts` (file terpisah).
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { channels } from "./channels";

/**
 * Channel naming convention:
 *   "session:<sessionId>" — perubahan apapun di session
 *   "staff:<barId>"       — perubahan untuk staff dashboard
 *   "bar:<barId>"         — perubahan floor map (semua session/member/order)
 *
 * Payload kecil saja — receiver tinggal trigger refetch / router.refresh().
 * Notify is best-effort: kalau koneksi DB drop antara commit dan notify,
 * notify hilang. Acceptable untuk realtime UI hints.
 */
export async function notify(
  channel: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  if (channel.length > 63) {
    console.warn(`[notify] channel name >63 chars, truncated: ${channel}`);
    channel = channel.slice(0, 63);
  }
  try {
    await db.execute(sql`SELECT pg_notify(${channel}, ${JSON.stringify(payload)})`);
  } catch (err) {
    console.error(`[notify] failed for channel ${channel}:`, err);
  }
}

/**
 * Notify trio: session + staff + bar. Dipakai server actions yang affect
 * floor view + staff dashboard + customer session view. Parallel execution.
 */
export async function notifyAll(
  sessionId: string,
  barId: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await Promise.all([
    notify(channels.session(sessionId), payload),
    notify(channels.staff(barId), payload),
    notify(channels.bar(barId), payload),
  ]);
}
