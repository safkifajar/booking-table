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
    },
  },
  images: {
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
};

export default nextConfig;
