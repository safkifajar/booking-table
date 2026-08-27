import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Konfigurasi pengujian.
 *
 * Hanya menyertakan berkas di src/lib/__tests__/ — SENGAJA tak menyapu
 * seluruh src, supaya 13 skrip scripts/test-*.ts (pemeriksaan manual yang
 * dijalankan sendiri dengan tsx, butuh database & jaringan) tak ikut
 * terjaring dan membuat `npm test` gagal.
 */
export default defineConfig({
  test: {
    include: ["src/lib/__tests__/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` cuma PENANDA build Next.js — ia melempar galat begitu
      // dimuat di luar Server Component. Tak ada perilaku yang perlu diuji,
      // jadi diarahkan ke modul kosong supaya berkas ber-penanda itu tetap
      // bisa diuji fungsi murninya.
      "server-only": fileURLToPath(
        new URL("./src/lib/__tests__/stub-server-only.ts", import.meta.url)
      ),
    },
  },
});
