import "server-only";
import postgres from "postgres";

/**
 * Dedicated Postgres LISTEN client untuk SSE realtime.
 *
 * Why separate dari main pool:
 * - LISTEN butuh long-lived connection (selama browser EventSource terbuka)
 * - Main pool (drizzle) max 10 connections — kalau dipakai untuk LISTEN, query
 *   biasa kehabisan slot
 * - Listener pool: max sebanyak browser tab yang terbuka (target ~50-100)
 *
 * Architecture:
 * - 1 postgres.js client instance (shared across all SSE endpoints)
 * - postgres.js `.listen()` per channel → internal subscriber count
 * - Multiple SSE endpoints subscribe channel yang sama → shared 1 LISTEN
 *
 * postgres.js handle reconnect otomatis kalau koneksi drop.
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// HMR safe: reuse di dev
const globalForListener = globalThis as unknown as {
  pgListener: ReturnType<typeof postgres> | undefined;
};

export const listener =
  globalForListener.pgListener ??
  postgres(DATABASE_URL, {
    // Listener pool — max 50 concurrent listeners.
    // VPS hostinger KVM 2: Postgres default max_connections=100, jadi
    // 50 listener + 10 main pool + 40 spare untuk Adminer / migrations = aman.
    max: 50,
    idle_timeout: 0, // jangan timeout — LISTEN persistent
    connect_timeout: 10,
    // Recycle koneksi LISTEN tiap 1 jam. postgres.js otomatis re-LISTEN
    // channel yang aktif setelah reconnect, jadi subscription tetap jalan.
    // TANPA statement_timeout — koneksi LISTEN memang menggantung selamanya.
    max_lifetime: 60 * 60,
    ssl: DATABASE_URL.includes("sslmode=require") ? "require" : false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForListener.pgListener = listener;
}
