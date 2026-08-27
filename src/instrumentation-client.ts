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
    // Google Translate menyisipkan <font> & memindahkan node, sehingga React
    // kehilangan node yang dipeganginya. Halaman sudah diberi
    // translate="no", tapi tab yang terlanjur menyala tetap memunculkannya.
    "The object can not be found here",
    "NotFoundError",
  ],

  /**
   * Buang galat yang jelas BUKAN dari aplikasi kita.
   *
   * Ekstensi browser & skrip pihak ketiga yang disuntikkan ke halaman
   * melempar galat dengan ciri khas: pesan teracak satu-dua huruf
   * ("Error: Da"), atau stack yang menunjuk `undefined`/`chrome-extension://`
   * karena berkas sumbernya tak pernah kita muat. Selama ini semuanya masuk
   * dan menutupi bug sungguhan.
   */
  beforeSend(event) {
    const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
    const files = frames.map((f) => f.filename ?? "");

    // Tak ada satu pun frame yang berasal dari berkas kita → bukan bug kita.
    const asing = (f: string) =>
      f.startsWith("chrome-extension://") ||
      f.startsWith("moz-extension://") ||
      f.startsWith("safari-extension://") ||
      f === "undefined" ||
      f === "<anonymous>" ||
      f === "";
    if (files.length > 0 && files.every(asing)) return null;

    // Pesan teracak sangat pendek tanpa spasi — khas kode yang diminifikasi
    // pihak lain ("Da", "xN"). Galat kita selalu punya kalimat yang bisa
    // dibaca.
    const msg = event.exception?.values?.[0]?.value ?? "";
    if (/^[A-Za-z$_]{1,3}$/.test(msg.trim())) return null;

    return event;
  },
});

// Wajib untuk Next.js App Router: melaporkan waktu navigasi antar-halaman.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
