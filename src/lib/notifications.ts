"use server";

/**
 * Notifikasi in-app. createNotification dipakai server actions lain (mis.
 * openTable saat ajak/undang user). Query + mark-read dipakai NotificationBell.
 *
 * Realtime: createNotification trigger Postgres NOTIFY ke channel
 * "user:<profileId>" → SSE /api/realtime/user/[userId] → bell refresh.
 */

import { eq, and, desc, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema/notifications";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { sendPushToProfile } from "@/lib/push";

type NotifType =
  | "table_joined"
  | "table_invite"
  | "invite_accepted"
  | "invite_rejected"
  | "general";

export interface AdminNotificationRow {
  id: string;
  type: NotifType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  /** Notif undangan sudah direspon (terima/tolak) → tombol aksi disembunyikan. */
  responded: boolean;
  created_at: string;
}

/**
 * Buat notif untuk 1 user + push realtime. Dipanggil dari server actions lain.
 * Best-effort: kalau notify gagal, notif tetap tersimpan (bell tetap update
 * saat refresh berikutnya).
 */
export async function createNotification(input: {
  profileId: string;
  type: NotifType;
  title: string;
  body?: string | null;
  link?: string | null;
}): Promise<void> {
  await db.insert(notifications).values({
    profileId: input.profileId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  });
  // Realtime in-app (SSE) — refresh bell.
  await notify(channels.user(input.profileId), { kind: "notification" });
  // Web push (popup OS, walau web ditutup) — best-effort, jangan gagalkan flow.
  void sendPushToProfile(input.profileId, {
    title: input.title,
    body: input.body ?? undefined,
    url: input.link ?? undefined,
  }).catch(() => {});
}

/** List notif user yg sedang login (terbaru dulu, limit). */
export async function getNotifications(
  limit = 20
): Promise<AdminNotificationRow[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      respondedAt: notifications.respondedAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.profileId, profile.id))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as NotifType,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.readAt != null,
    responded: r.respondedAt != null,
    created_at: r.createdAt.toISOString(),
  }));
}

/**
 * Tandai notif undangan (table_invite) milik user login sebagai SUDAH direspon
 * (dipanggil setelah acceptInvite/declineInvite). Dimatch by link
 * (/session/<id>) karena notif tidak menyimpan sessionId terstruktur.
 * Sekaligus set read_at supaya badge unread ikut turun.
 */
export async function markInviteResponded(link: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  const now = new Date();
  await db
    .update(notifications)
    .set({ respondedAt: now, readAt: now })
    .where(
      and(
        eq(notifications.profileId, profile.id),
        eq(notifications.type, "table_invite"),
        eq(notifications.link, link),
        isNull(notifications.respondedAt)
      )
    );
}

/** Jumlah notif belum dibaca user login. */
export async function getUnreadCount(): Promise<number> {
  const profile = await getCurrentProfile();
  if (!profile) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.profileId, profile.id),
        isNull(notifications.readAt)
      )
    );
  return Number(row?.c ?? 0);
}

export async function markNotificationRead(id: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.id, id), eq(notifications.profileId, profile.id))
    );
}

export async function markAllNotificationsRead(): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.profileId, profile.id),
        isNull(notifications.readAt)
      )
    );
}
