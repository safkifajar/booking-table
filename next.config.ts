import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Native binaries / Node-only modules — externalize supaya tidak di-bundle
   * oleh webpack. Runtime di-require langsung dari node_modules.
   *
   * - sharp: native binary (image processing)
   * - heic-convert: heavy + dynamic require chain
   */
  serverExternalPackages: ["sharp", "heic-convert", "xlsx", "jszip"],
  experimental: {
    /**
     * Server Actions body limit. Default Next.js cuma 1MB — terlalu kecil
     * untuk upload (banner/menu/avatar) yg dikirim via FormData ke action.
     * Naikkan ke 12MB supaya file s/d 10MB (+overhead) lolos ke validasi app.
     */
    serverActions: {
      bodySizeLimit: "12mb",
      /**
       * Izinkan Server Actions dipanggil saat app dibuka dari device lain di
       * LAN (mis. tes dari HP via http://192.168.x.x:3000). Tanpa ini Next.js
       * memblokir action krn origin ≠ server origin → tombol sign in/signup/
       * magic link "tidak ada action". Dev-only; produksi pakai domain HTTPS.
       */
      allowedOrigins: [
        "localhost:3000",
        "192.168.1.3:3000",
        "*.local:3000",
      ],
    },
  },
  /**
   * Izinkan dev resources (HMR) diakses dari device LAN saat tes mobile.
   * Dev-only.
   */
  allowedDevOrigins: ["192.168.1.3"],
  images: {
    /**
     * Matikan Image Optimization. Semua gambar app = lokal: static /public
     * atau file upload /uploads/** yang di-serve nginx (di luar app dir, path
     * persistent UPLOADS_DIR). Optimizer Next me-rewrite src ke /_next/image
     * lalu fetch file dari origin-nya sendiri — di VPS file /uploads/ TIDAK
     * ada di proses Next (nginx yang serve) → "received null" → gambar rusak.
     * Upload sudah dikompres ke webp saat unggah (sharp), jadi optimasi ulang
     * tak perlu. Tak ada gambar remote (remotePatterns kosong). unoptimized =
     * <Image> serve URL apa adanya → nginx/public yang layani → semua tampil.
     */
    unoptimized: true,
    /**
     * File upload lokal (/uploads/**) dipakai <Image> dengan query string
     * cache-bust (?v=timestamp). Next 16 butuh localPatterns; `search` di-omit
     * supaya query string apa pun (?v=...) lolos. Tanpa ini → error
     * "not configured in images.localPatterns".
     */
    localPatterns: [
      {
        pathname: "/uploads/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // Service worker jangan di-cache lama supaya update SW cepat terdeteksi.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
