import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * sharp adalah native binary — externalize supaya tidak di-bundle.
   * Runtime di-require langsung dari node_modules (PM2 di VPS).
   */
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
