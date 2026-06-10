/**
 * Smoke test: verify Drizzle client can connect & query.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log("🔌 Testing Drizzle connection...\n");

  // Test 1: raw query
  const result = await client`select version()`;
  console.log(`✅ Postgres: ${result[0].version.split(",")[0]}`);

  // Test 2: query via Drizzle ORM
  const bar = await db.query.bars.findFirst({
    with: {
      areas: {
        with: {
          tables: true,
        },
      },
    },
  });

  if (!bar) {
    console.log("❌ Bar tidak ditemukan — seed belum jalan?");
    process.exit(1);
  }

  console.log(`✅ Bar: ${bar.name}`);
  console.log(`   Areas: ${bar.areas.length}`);
  bar.areas.forEach((a) => {
    console.log(`   - ${a.name}: ${a.tables.length} tables`);
  });

  // Test 3: filter query
  const cocktails = await db.query.menuItems.findMany({
    where: (mi, { sql }) => sql`'alcoholic' = ANY(${mi.tags})`,
    limit: 5,
  });
  console.log(`✅ Found ${cocktails.length} alcoholic items (sample)`);

  await client.end();
  console.log("\n🎉 All tests passed!");
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
