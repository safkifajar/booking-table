/**
 * Cron job: umumkan promo/event baru ke customer saat bannernya MULAI TAYANG.
 *
 * Dikirim saat tayang (bukan saat dibuat) supaya banner yang dijadwalkan
 * bulan depan tak mengganggu customer sekarang. Sekali per banner —
 * dijaga bar_banners.notified_at.
 *
 * Production: trigger via systemd timer (lihat docs/DEPLOYMENT.md).
 * Tiap 15 menit sudah cukup — promo tak sesensitif waktu seperti booking.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>`.
 */

import { notifyNewBanners } from "@/lib/banner-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await notifyNewBanners();
  return Response.json(result);
}

// GET untuk health check (tidak butuh secret)
export async function GET() {
  return Response.json({
    status: "ok",
    info: "POST with Bearer auth to announce newly live banners",
  });
}
