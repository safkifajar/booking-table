/**
 * Next.js instrumentation — jalan sekali saat server boot.
 *
 * Kita pakai untuk start in-process scheduler buat auto-expire stories
 * di environment dev (tidak ada systemd timer). Di production, scheduler
 * juga bisa tetap jalan sebagai backup kalau systemd belum diset — idempotent
 * dengan endpoint /api/cron/expire-stories.
 *
 * Interval: 15 menit (production sync), 5 menit di dev supaya cepat keliatan
 * cleanup-nya saat testing.
 */

export async function register() {
  // Hanya jalan di Node runtime (bukan edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Cegah double-register saat HMR di dev — pakai flag global
  const flag = "__booking_stories_scheduler__";
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[flag]) return;
  g[flag] = true;

  // Lazy import supaya tidak ke-load saat edge runtime atau build
  const { expireOldStories } = await import("@/lib/stories-expire");

  const isDev = process.env.NODE_ENV === "development";
  const intervalMs = isDev ? 5 * 60 * 1000 : 15 * 60 * 1000;

  console.log(
    `[stories-expire] scheduler started (interval: ${intervalMs / 1000}s)`
  );

  // Run once at startup setelah delay singkat supaya server boot dulu
  setTimeout(() => {
    void run();
  }, 10_000);

  // Periodic
  setInterval(() => {
    void run();
  }, intervalMs);

  async function run() {
    try {
      const result = await expireOldStories();
      if (result.deleted > 0) {
        console.log(
          `[stories-expire] deleted ${result.deleted} expired stories in ${result.durationMs}ms`
        );
      }
    } catch (err) {
      console.error("[stories-expire] failed:", err);
    }
  }
}
