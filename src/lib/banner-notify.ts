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

  // Penerima: SEMUA customer terdaftar (bukan staff, bukan tamu walk-in,
  // akun masih aktif). Diambil SEKALI di luar loop — daftarnya sama untuk
  // semua banner, jadi tak perlu query ulang per banner.
  const recipients = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.isGuest, false), eq(profiles.isActive, true)));
  const staffRows = await db
    .select({ id: staffRoles.profileId })
    .from(staffRoles);
  const staffSet = new Set(staffRows.map((s) => s.id));
  // Staff tak perlu notif promo — mereka yang membuatnya.
  const targets = recipients.filter((r) => !staffSet.has(r.id));

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

    const isEvent = b.category === "event";
    const title = b.title?.trim() || (isEvent ? "New event" : "New promo");
    const body =
      b.subtitle?.trim() ||
      (isEvent
        ? "A new event just went live. Tap to see the details."
        : "A new promo just went live. Tap to see the details.");

    for (const r of targets) {
      try {
        await createNotification({
          profileId: r.id,
          type: "promo_new",
          title: isEvent ? `Event: ${title}` : `Promo: ${title}`,
          body,
          link: `/promo/${b.id}`,
          refId: b.id,
        });
        notified++;
      } catch (err) {
        console.error("[banner-notify] gagal kirim:", r.id, err);
      }
    }
  }

  return { banners, notified, durationMs: Date.now() - startedAt };
}
