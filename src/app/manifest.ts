import type { MetadataRoute } from "next";

/**
 * PWA manifest — supaya web bisa di-"install" ke home screen (Android/desktop)
 * dan Web Push jalan di iOS (wajib PWA install, iOS 16.4+).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SOHO Social House",
    short_name: "SOHO",
    description: "Book a table & hang out at SOHO Social House.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
