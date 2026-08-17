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
import { profiles } from "@/lib/db/schema/profiles";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { sendPushToProfile } from "@/lib/push";

type NotifType =
  | "table_joined"
  | "table_invite"
  | "invite_accepted"
  | "invite_rejected"
  | "invite_cancelled"
  | "move_request"
  | "move_approved"
  | "move_rejected"
  | "payment_received"
  | "payment_cancelled"
  | "friend_request"
  | "friend_accepted"
  | "story_mention"
  | "booking_reminder"
  | "promo_new"
  | "general";

export interface AdminNotificationRow {
  id: string;
  type: NotifType;
  title: string;
  body: string | null;
  link: string | null;
  /** Gambar pendukung (mis. banner promo) — thumbnail di list. */
  image_url: string | null;
  read: boolean;
  /** Notif undangan sudah direspon (terima/tolak) → tombol aksi disembunyikan. */
  responded: boolean;
  /** ID entitas sumber (mis. friend_requests.id) — utk tombol aksi by ID. */
  ref_id: string | null;
  created_at: string;
  /** Profil pengirim (mention/repost/friend). NULL = notif sistem. */
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar_url: string | null;
}

/**
 * Buat notif untuk 1 user + push realtime. Dipanggil dari server actions lain.
 * Best-effort: kalau notify gagal, notif tetap tersimpan (bell tetap update
 * saat refresh berikutnya).
 */
/**
 * Path relatif → URL absolut untuk payload web push. Service worker berjalan
 * di luar konteks halaman, jadi path relatif tak bisa di-resolve olehnya.
 * Sudah absolut (http/https) → dibiarkan.
 */
function toAbsoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function createNotification(input: {
  profileId: string;
  type: NotifType;
  title: string;
  body?: string | null;
  link?: string | null;
  /** ID entitas sumber (mis. friend_requests.id) — utk update notif by ID. */
  refId?: string | null;
  /**
   * Profil PENGIRIM — dipakai menampilkan fotonya di list notifikasi.
   * Kosongkan untuk notif sistem (pembayaran/booking) → UI pakai ikon jenis.
   */
  actorId?: string | null;
  /** true = simpan + bell saja, TANPA web push (mis. anti-spam request ulang). */
  skipPush?: boolean;
  /**
   * Gambar pendukung (mis. banner promo) — thumbnail di list in-app +
   * gambar besar di push. Boleh path relatif ("/uploads/x.jpg"); untuk push
   * otomatis diubah jadi URL absolut.
   */
  imageUrl?: string | null;
}): Promise<void> {
  await db.insert(notifications).values({
    profileId: input.profileId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    imageUrl: input.imageUrl ?? null,
    refId: input.refId ?? null,
    actorId: input.actorId ?? null,
  });
  // Realtime in-app (SSE) — refresh bell.
  await notify(channels.user(input.profileId), { kind: "notification" });
  // Web push (popup OS, walau web ditutup) — best-effort, jangan gagalkan flow.
  if (!input.skipPush) {
    void sendPushToProfile(input.profileId, {
      title: input.title,
      body: input.body ?? undefined,
      url: input.link ?? undefined,
      // Push butuh URL ABSOLUT — service worker tak punya konteks origin.
      image: input.imageUrl ? toAbsoluteUrl(input.imageUrl) : undefined,
    }).catch(() => {});
  }
}

/**
 * Tandai notif ber-ref_id sudah direspon (tombol aksi hilang dari bell).
 * Match by ID entitas — BUKAN teks link (rapuh, PRD Friends 10.5).
 */
export async function markNotificationRespondedByRef(
  profileId: string,
  refId: string
): Promise<void> {
  await db
    .update(notifications)
    .set({ respondedAt: new Date() })
    .where(
      and(eq(notifications.profileId, profileId), eq(notifications.refId, refId))
    );
  await notify(channels.user(profileId), { kind: "notification" });
}

/**
 * Hapus notif ber-ref_id (mis. friend request dibatalkan/di-blokir -> entri
 * bell penerima dicabut). TANPA push apa pun — penghapusan harus senyap
 * (PRD Friends 7.3: jangan bocorkan blokir).
 */
export async function deleteNotificationsByRef(refId: string): Promise<void> {
  const rows = await db
    .delete(notifications)
    .where(eq(notifications.refId, refId))
    .returning({ profileId: notifications.profileId });
  // Refresh bell pemilik notif yang terhapus (best-effort, tanpa push).
  const owners = new Set(rows.map((r) => r.profileId));
  await Promise.allSettled(
    Array.from(owners).map((pid) =>
      notify(channels.user(pid), { kind: "notification" })
    )
  );
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
      imageUrl: notifications.imageUrl,
      readAt: notifications.readAt,
      respondedAt: notifications.respondedAt,
      refId: notifications.refId,
      createdAt: notifications.createdAt,
      actorId: notifications.actorId,
      actorName: profiles.displayName,
      actorAvatarUrl: profiles.avatarUrl,
    })
    .from(notifications)
    // LEFT JOIN: notif sistem tak punya aktor — barisnya tetap ikut.
    .leftJoin(profiles, eq(profiles.id, notifications.actorId))
    .where(eq(notifications.profileId, profile.id))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as NotifType,
    title: r.title,
    body: r.body,
    link: r.link,
    image_url: r.imageUrl,
    read: r.readAt != null,
    responded: r.respondedAt != null,
    ref_id: r.refId,
    created_at: r.createdAt.toISOString(),
    actor_id: r.actorId,
    actor_name: r.actorName,
    actor_avatar_url: r.actorAvatarUrl,
  }));
}

/**
 * Tandai notif undangan (table_invite) milik user login sebagai SUDAH direspon
 * (dipanggil setelah acceptInvite/declineInvite). Dimatch by link
 * (/session/<id>) karena notif tidak menyimpan sessionId terstruktur.
 *
 * Sekalian ubah `type` jadi invite_accepted / invite_rejected supaya UI bisa
 * tampilkan hasil respon (Diterima/Ditolak), dan set read_at supaya badge
 * unread ikut turun.
 */
export async function markInviteResponded(
  link: string,
  outcome: "accepted" | "rejected"
): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  const now = new Date();
  await db
    .update(notifications)
    .set({
      respondedAt: now,
      readAt: now,
      type: outcome === "accepted" ? "invite_accepted" : "invite_rejected",
    })
    .where(
      and(
        eq(notifications.profileId, profile.id),
        eq(notifications.type, "table_invite"),
        eq(notifications.link, link),
        isNull(notifications.respondedAt)
      )
    );
}

/**
 * Host membatalkan undangan: ubah notif undangan (table_invite) milik
 * `profileId` jadi 'invite_cancelled' — tombol Terima/Tolak hilang, judul/body
 * jadi "dibatalkan", dan jadikan UNREAD lagi (readAt null) supaya user sadar.
 * Sekalian trigger realtime + push (ini sekaligus pemberitahuan pembatalan).
 */
export async function markInviteCancelled(
  profileId: string,
  link: string,
  tableLabel: string
): Promise<void> {
  const title = `Invite to table ${tableLabel} was cancelled`;
  const body = "The host cancelled this invite.";
  const res = await db
    .update(notifications)
    .set({
      type: "invite_cancelled",
      title,
      body,
      respondedAt: new Date(),
      readAt: null, // jadikan unread lagi → user lihat update
    })
    .where(
      and(
        eq(notifications.profileId, profileId),
        eq(notifications.type, "table_invite"),
        eq(notifications.link, link)
      )
    )
    .returning({ id: notifications.id });

  // Kalau notif undangan aslinya sudah tidak ada (mis. terhapus), buat baru
  // supaya user tetap diberi tahu pembatalan.
  if (res.length === 0) {
    await db.insert(notifications).values({
      profileId,
      type: "invite_cancelled",
      title,
      body,
      link,
    });
  }

  await notify(channels.user(profileId), { kind: "notification" });
  void sendPushToProfile(profileId, { title, body, url: link }).catch(() => {});
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

/** Hapus satu notifikasi milik user login (scoped by profileId — aman). */
export async function deleteNotification(id: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  await db
    .delete(notifications)
    .where(
      and(eq(notifications.id, id), eq(notifications.profileId, profile.id))
    );
}
