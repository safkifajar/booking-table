/**
 * Cron job: kirim pengingat menjelang jam booking (in-app + push).
 *
 * Lead time diatur admin per bar: Settings → Reservation →
 * "Remind guests before booking time". 0 = pengingat mati.
 *
 * Production: trigger via systemd timer panggil endpoint ini berkala
 * (lihat docs/DEPLOYMENT.md section "Cron Jobs"). Tiap 5 menit — makin
 * rapat makin akurat waktunya; sekali-kirim dijaga reminder_sent_at.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>`.
 *
 * Dev: instrumentation.ts auto-run berkala (skip endpoint ini).
 */

import { sendBookingReminders } from "@/lib/booking-reminder";
import { withCronLock, CRON_LOCK } from "@/lib/cron-lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Guard: kalau proses sebelumnya masih jalan (mis. antrean panjang saat
  // banyak booking serentak), jadwal berikutnya BERHENTI alih-alih ikut
  // mengerjakan pekerjaan yang sama.
  const run = await withCronLock(CRON_LOCK.bookingReminder, () =>
    sendBookingReminders()
  );
  if (run.skipped) {
    return Response.json({ skipped: true, reason: "already running" });
  }
  return Response.json(run.result);
}

// GET untuk health check (tidak butuh secret)
export async function GET() {
  return Response.json({
    status: "ok",
    info: "POST with Bearer auth to send booking reminders",
  });
}
