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
};

export default nextConfig;
