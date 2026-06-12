/**
 * Cron job: hapus story yang sudah expire (lebih dari 24 jam).
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
  return Response.json(result);
}

// GET untuk health check (tidak butuh secret)
export async function GET() {
  return Response.json({
    status: "ok",
    info: "POST with Bearer auth to trigger story expiration",
  });
}
