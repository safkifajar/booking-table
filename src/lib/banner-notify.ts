import "server-only";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { barBanners } from "@/lib/db/schema/banners";
import { profiles } from "@/lib/db/schema/profiles";
import { staffRoles } from "@/lib/db/schema/extras";
import { createNotification } from "@/lib/notifications";

/**
 * Umumkan promo/event baru ke customer saat bannernya MULAI TAYANG.
 *
 * Dipanggil cron berkala (/api/cron/banner-notify). Prinsip:
 * - Dikirim saat TAYANG, bukan saat dibuat. Banner yang dijadwalkan bulan
 *   depan tak boleh mengganggu customer sekarang — mereka akan diberi tahu
 *   tepat saat promonya benar-benar berlaku.
 * - SEKALI saja per banner: ditandai bar_banners.notified_at. Tanpa ini
 *   SELURUH customer dikirimi notif berulang tiap cron menyala.
 * - Hanya customer: staff & tamu walk-in dilewati.
 * - Best-effort: satu notifikasi gagal tak menggagalkan sisanya.
 */

export interface BannerNotifyResult {
  /** Banner yang diumumkan. */
  banners: number;
  /** Notifikasi yang berhasil dibuat. */
  notified: number;
  durationMs: number;
}

export async function notifyNewBanners(): Promise<BannerNotifyResult> {
  const startedAt = Date.now();
  const now = new Date();

  // Banner aktif yang sudah waktunya tayang, belum pernah diumumkan, dan
  // belum kedaluwarsa (promo yang sudah lewat tak perlu diumumkan).
  const due = await db
    .select({
      id: barBanners.id,
      barId: barBanners.barId,
      title: barBanners.title,
      subtitle: barBanners.subtitle,
      category: barBanners.category,
      imageUrl: barBanners.imageUrl,
    })
    .from(barBanners)
    .where(
      and(
        eq(barBanners.isActive, true),
        isNull(barBanners.notifiedAt),
        or(isNull(barBanners.startsAt), lte(barBanners.startsAt, now)),
        // Belum kedaluwarsa — promo yang sudah lewat tak perlu diumumkan.
        or(isNull(barBanners.endsAt), gte(barBanners.endsAt, now))
      )
    );

  if (due.length === 0) {
    return { banners: 0, notified: 0, durationMs: Date.now() - startedAt };
  }

  const targets = await getPromoRecipients();

  let banners = 0;
  let notified = 0;

  for (const b of due) {
    // Tandai TERKIRIM LEBIH DULU (conditional). Kalau ditandai belakangan,
    // cron yang tumpang-tindih bisa mengirim ke seluruh customer dua kali —
    // jauh lebih merusak daripada satu pengumuman terlewat.
    const [claimed] = await db
      .update(barBanners)
      .set({ notifiedAt: now })
      .where(and(eq(barBanners.id, b.id), isNull(barBanners.notifiedAt)))
      .returning({ id: barBanners.id });
    if (!claimed) continue; // sudah diklaim proses lain
    banners++;

    notified += await sendBannerNotification(b, targets);
  }

  return { banners, notified, durationMs: Date.now() - startedAt };
}

/**
 * Daftar penerima notif promo: SEMUA customer terdaftar & aktif. Staff
 * dilewati (mereka yang membuat promonya), tamu walk-in juga (tak punya akun).
 */
async function getPromoRecipients(): Promise<{ id: string }[]> {
  const recipients = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.isGuest, false), eq(profiles.isActive, true)));
  const staffRows = await db
    .select({ id: staffRoles.profileId })
    .from(staffRoles);
  const staffSet = new Set(staffRows.map((s) => s.id));
  return recipients.filter((r) => !staffSet.has(r.id));
}

/**
 * Kirim notif satu banner ke daftar penerima. Return jumlah yang berhasil.
 * Best-effort: satu penerima gagal tak menghentikan sisanya.
 *
 * Dipakai DUA jalur: cron (otomatis saat banner mulai tayang) & tombol
 * "Send notification" di admin (manual, tanpa menunggu cron).
 */
async function sendBannerNotification(
  b: {
    id: string;
    title: string | null;
    subtitle: string | null;
    category: string;
    imageUrl: string;
  },
  targets: { id: string }[]
): Promise<number> {
  const isEvent = b.category === "event";
  const title = b.title?.trim() || (isEvent ? "New event" : "New promo");
  const body =
    b.subtitle?.trim() ||
    (isEvent
      ? "A new event just went live. Tap to see the details."
      : "A new promo just went live. Tap to see the details.");

  let sent = 0;
  for (const r of targets) {
    try {
      await createNotification({
        profileId: r.id,
        type: "promo_new",
        title: isEvent ? `Event: ${title}` : `Promo: ${title}`,
        body,
        link: `/promo/${b.id}`,
        // Banner tampil sbg thumbnail di list in-app & gambar besar di push.
        imageUrl: b.imageUrl,
        refId: b.id,
      });
      sent++;
    } catch (err) {
      console.error("[banner-notify] gagal kirim:", r.id, err);
    }
  }
  return sent;
}

/**
 * Kirim notif banner SEKARANG — dipicu tombol admin, tanpa menunggu cron.
 *
 * Beda dari jalur cron:
 * - Tak memeriksa/menunggu jadwal tayang: admin yang memutuskan.
 * - BOLEH dikirim ulang (mis. promo penting diumumkan dua kali). Karena itu
 *   pemanggil WAJIB mengonfirmasi ke admin dulu — sekali terkirim tak bisa
 *   dibatalkan.
 * - Tetap menandai notified_at supaya cron tak mengirim ulang setelahnya.
 */
export async function sendBannerNotificationNow(
  bannerId: string
): Promise<{ ok: boolean; error?: string; notified?: number }> {
  const [banner] = await db
    .select({
      id: barBanners.id,
      title: barBanners.title,
      subtitle: barBanners.subtitle,
      category: barBanners.category,
      imageUrl: barBanners.imageUrl,
      isActive: barBanners.isActive,
    })
    .from(barBanners)
    .where(eq(barBanners.id, bannerId));

  if (!banner) return { ok: false, error: "Banner not found" };
  if (!banner.isActive) {
    return {
      ok: false,
      error: "Turn the banner Active first — customers can't open it yet",
    };
  }

  const targets = await getPromoRecipients();
  if (targets.length === 0) {
    return { ok: false, error: "No registered customers to notify yet" };
  }

  const notified = await sendBannerNotification(banner, targets);

  // Tandai terkirim supaya cron tak mengumumkannya lagi secara otomatis.
  await db
    .update(barBanners)
    .set({ notifiedAt: new Date() })
    .where(and(eq(barBanners.id, bannerId), isNull(barBanners.notifiedAt)));

  return { ok: true, notified };
}
