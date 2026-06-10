import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// Load .env.local (Next.js convention) sebelum read env
config({ path: ".env.local" });

/**
 * Drizzle Kit config — pakai untuk generate migration, push schema, introspect.
 *
 * Commands:
 *   npx drizzle-kit push           - sync schema ke DB (dev only, no migration file)
 *   npx drizzle-kit generate       - generate SQL migration file dari schema changes
 *   npx drizzle-kit migrate        - apply pending migrations ke DB
 *   npx drizzle-kit studio         - browse data via web UI
 */
export default {
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
