/**
 * PM2 process config untuk production (VPS).
 *
 * Pakai: `pm2 start ecosystem.config.js && pm2 save`
 *
 * Catatan deploy:
 * - `cwd` default = folder file ini (__dirname). Override kalau struktur beda.
 * - Env produksi (DATABASE_URL, AUTH_SECRET, VAPID, RESEND, UPLOADS_DIR, dll)
 *   dibaca dari `.env.local` oleh Next.js — TIDAK ditaruh di sini.
 * - `kill_timeout`: beri Next.js waktu menuntaskan in-flight request + callback
 *   after() saat SIGTERM (restart/deploy) sebelum di-force kill. Next.js 16
 *   sudah graceful-shutdown bawaan; ini cuma memberi jeda drain-nya.
 */
module.exports = {
  apps: [
    {
      name: "booking-table",
      script: "npm",
      args: "start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      // Graceful shutdown: tunggu s/d 15 dtk sebelum SIGKILL (drain request).
      kill_timeout: 15000,
      // Beri tahu PM2 menunggu app "ready" (opsional; aman walau tak dipakai).
      listen_timeout: 10000,
    },
  ],
};
