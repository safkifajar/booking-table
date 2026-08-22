/**
 * Cron job: hapus story yang sudah expire (lebih dari 24 jam), sekaligus
 * pembersihan berkala lain yang tak butuh jadwal sendiri.
 *
 * Production: trigger via systemd timer panggil endpoint ini berkala
 * (lihat docs/DEPLOYMENT.md section "Cron Jobs"). Tiap 15 menit.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>`.
 * Set di .env.local: CRON_SECRET=<random 32+ char>
 *
 * Dev: instrumentation.ts auto-run setiap 15 menit (skip endpoint ini).
 *
 * Hapus permanent: row dari DB + file dari storage.
 */

import { expireOldStories } from "@/lib/stories-expire";
import { purgeOldEmailLogs } from "@/lib/email-log-actions";
import { purgeExpiredResetTokens } from "@/lib/auth-v2/reset-password";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  // Auth check
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await expireOldStories();

  // Menumpang jadwal ini daripada menyiapkan timer systemd sendiri —
  // keduanya cuma menghapus baris tua & tak bergantung waktu tertentu.
  // Kegagalannya TIDAK boleh menggagalkan penghapusan story, jadi
  // dijalankan terpisah & hasilnya sekadar dilaporkan.
  const [emailLogs, resetTokens] = await Promise.allSettled([
    purgeOldEmailLogs(),
    purgeExpiredResetTokens(),
  ]);

  return Response.json({
    ...result,
    emailLogsPurged:
      emailLogs.status === "fulfilled" ? emailLogs.value : "failed",
    resetTokensPurged:
      resetTokens.status === "fulfilled" ? resetTokens.value : "failed",
  });
}

// GET untuk health check (tidak butuh secret)
export async function GET() {
  return Response.json({
    status: "ok",
    info: "POST with Bearer auth to trigger story expiration",
  });
}
