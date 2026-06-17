import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Singleton Postgres client.
 *
 * Untuk dev: pakai `postgres.js` driver yang ringan + connection pooling built-in.
 * Untuk production di Vercel serverless: tetap pakai postgres.js dengan max=1
 * (atau pakai PgBouncer di VPS dengan transaction mode).
 *
 * Connection string format:
 *   postgres://user:password@host:port/database?sslmode=require
 */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local: DATABASE_URL=postgres://..."
  );
}

// Reuse connection across HMR di dev mode
const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined;
};

const pgClient =
  globalForDb.pgClient ??
  postgres(DATABASE_URL, {
    // Vercel serverless: max=1 supaya tidak overflow connection pool
    // Local dev / VPS dedicated: bisa lebih (10-20)
    max: process.env.VERCEL ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Recycle koneksi tiap 1 jam. Mencegah koneksi "basi" (mis. setelah
    // Postgres restart / network blip) bertahan di pool dan melempar error
    // di query berikutnya — penyebab error "Failed query" intermittent.
    max_lifetime: 60 * 60,
    // Kill query yang menggantung >30s supaya satu query lambat tidak
    // memblokir slot pool (penting di VPS shared).
    connection: { statement_timeout: 30_000 },
    // SSL: required untuk production, optional di local
    ssl: DATABASE_URL.includes("sslmode=require") ? "require" : false,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pgClient = pgClient;

/**
 * Main DB instance — pakai ini untuk semua query.
 *
 * Usage:
 *   import { db } from "@/lib/db/client";
 *   const profile = await db.query.profiles.findFirst({ where: ... });
 */
export const db = drizzle(pgClient, { schema, logger: process.env.NODE_ENV === "development" });

export type DB = typeof db;

