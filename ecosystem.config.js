/**
 * PM2 process config — 2 environment di 1 VPS (staging + production).
 *
 * Pakai (di VPS):
 *   pm2 start ecosystem.config.js --only soho-prod     && pm2 save
 *   pm2 start ecosystem.config.js --only soho-staging  && pm2 save
 *   pm2 reload soho-prod --update-env                  # saat deploy
 *
 * Catatan deploy:
 * - Tiap environment = folder clone sendiri (cwd) + branch sendiri:
 *     soho-prod    → /home/booking/soho-prod    (branch main)   PORT 3000
 *     soho-staging → /home/booking/soho-staging (branch staging) PORT 3001
 * - Env produksi/staging (DATABASE_URL, AUTH_SECRET, AUTH_URL, VAPID, RESEND,
 *   UPLOADS_DIR, NEXT_PUBLIC_DEMO_MODE, CRON_SECRET, dll) dibaca dari `.env.local`
 *   di folder masing-masing oleh Next.js — TIDAK ditaruh di sini (jangan commit
 *   secret). Yang di-set di sini cuma NODE_ENV + PORT.
 * - `kill_timeout`: beri Next.js waktu menuntaskan in-flight request + callback
 *   after() saat SIGTERM (reload/deploy) sebelum di-force kill. Next.js 16 sudah
 *   graceful-shutdown bawaan; ini cuma memberi jeda drain-nya.
 * - Kalau struktur folder VPS beda, sesuaikan `cwd` di bawah.
 */

/** Opsi umum yang dipakai kedua environment. */
const common = {
  script: "npm",
  args: "start",
  // FORK mode wajib: `next start` bukan aplikasi cluster-aware. Cluster mode
  // bikin PM2 gagal boot ("errored" + restart loop). instances tetap 1.
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  max_memory_restart: "1G",
  // Graceful shutdown: tunggu s/d 15 dtk sebelum SIGKILL (drain request).
  kill_timeout: 15000,
  // Beri tahu PM2 menunggu app "ready" (opsional; aman walau tak dipakai).
  listen_timeout: 10000,
};

module.exports = {
  apps: [
    {
      ...common,
      name: "soho-prod",
      cwd: "/home/booking/soho-prod",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      ...common,
      name: "soho-staging",
      cwd: "/home/booking/soho-staging",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
