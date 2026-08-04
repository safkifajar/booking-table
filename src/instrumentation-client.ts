import * as Sentry from "@sentry/nextjs";

/**
 * Sentry — sisi BROWSER (error yang terjadi di device customer/staff).
 *
 * Aktif hanya kalau NEXT_PUBLIC_SENTRY_DSN di-set. Di development DSN sengaja
 * dikosongkan supaya error saat ngoding tidak memenuhi kuota & isu produksi.
 *
 * Hanya laporan error — tanpa performance tracing & session replay:
 * - hemat kuota free tier (5k error/bulan)
 * - tidak merekam layar/interaksi customer (privasi)
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? "production",
  // Tanpa tracing/replay (lihat catatan di atas).
  tracesSampleRate: 0,
  // Jangan kirim data pribadi (IP, cookie, header) secara default.
  sendDefaultPii: false,
  // Buang error yang bukan masalah aplikasi (noise dari browser/extension).
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    // Navigasi dibatalkan user / pindah halaman saat fetch berjalan.
    "AbortError",
    "The operation was aborted",
    "Failed to fetch",
    "NetworkError when attempting to fetch resource",
    "Load failed",
  ],
});

// Wajib untuk Next.js App Router: melaporkan waktu navigasi antar-halaman.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
