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
};

export default nextConfig;
