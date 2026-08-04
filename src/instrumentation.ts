import * as Sentry from "@sentry/nextjs";

/**
 * Sentry — sisi SERVER (Server Actions, route handler, render server).
 *
 * Aktif hanya kalau SENTRY_DSN di-set (production/staging di VPS). Di lokal
 * dibiarkan kosong supaya error saat ngoding tak terkirim.
 *
 * Hanya laporan error — tanpa performance tracing (hemat kuota free tier).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENV ?? "production",
      tracesSampleRate: 0,
      // Jangan kirim data pribadi (body request, cookie, IP) secara default.
      sendDefaultPii: false,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENV ?? "production",
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
  }
}

/**
 * Menangkap error dari Server Component / Server Action supaya muncul di
 * Sentry (Next.js memanggil hook ini saat request gagal).
 */
export const onRequestError = Sentry.captureRequestError;
