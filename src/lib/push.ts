"use server";

/**
 * Web Push (notif popup OS, walau web ditutup) via lib web-push + VAPID.
 *
 * - sendPushToProfile: kirim push ke semua device user (best-effort). Dipanggil
 *   dari createNotification → semua notif otomatis dapat push. Subscription
 *   expired (status 404/410) di-hapus otomatis.
 * - saveSubscription / removeSubscription: client subscribe/unsubscribe.
 *
 * No-op aman kalau VAPID env belum di-set (mis. dev tanpa keys).
 */

import webpush from "web-push";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema/push-subscriptions";
import { getCurrentProfile } from "@/lib/auth-v2/current";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  vapidReady = true;
  return true;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
}

/**
 * Kirim web push ke semua subscription milik profileId. Best-effort:
 * - VAPID belum di-set → no-op (return 0).
 * - tiap subscription independen (Promise.allSettled).
 * - status 404/410 (subscription expired/unsubscribed) → hapus dari DB.
 */
export async function sendPushToProfile(
  profileId: string,
  payload: PushPayload
): Promise<number> {
  if (!ensureVapid()) return 0;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.profileId, profileId));
  if (subs.length === 0) return 0;

  const data = JSON.stringify(payload);
  let sent = 0;

  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          data
        );
        sent++;
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired / unsubscribed → bersihkan.
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, s.endpoint));
        }
        // error lain: diam (best-effort).
      }
    })
  );

  return sent;
}

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** Simpan subscription device user (upsert by endpoint). */
export async function saveSubscription(
  input: z.infer<typeof subscriptionSchema>
): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("You must be logged in");
  const data = subscriptionSchema.parse(input);

  await db
    .insert(pushSubscriptions)
    .values({
      profileId: profile.id,
      endpoint: data.endpoint,
      p256dh: data.keys.p256dh,
      auth: data.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        profileId: profile.id,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
      },
    });
}

/** Hapus subscription (user unsubscribe / matikan notif di device ini). */
export async function removeSubscription(endpoint: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.profileId, profile.id)
      )
    );
}
