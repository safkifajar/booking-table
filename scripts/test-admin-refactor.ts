/**
 * Smoke test admin.ts RPC + Drizzle joins setelah Phase 3b refactor.
 *
 * Catatan: tidak import langsung admin.ts karena chain ke
 * auth-v2/current.ts yang import "server-only" — itu throws di plain Node.
 * Sebagai gantinya, kita panggil RPC functions di DB & verify
 * hasil queries.ts indirect (sudah tested di test-queries-refactor.ts).
 *
 * Untuk verify full chain admin.ts, browser test cukup (Phase 3c).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log("🧪 Testing admin RPC functions via Drizzle...\n");

  const bar = await db.query.bars.findFirst();
  if (!bar) {
    console.log("⚠️  No bar in DB. Aborting.");
    await client.end();
    process.exit(0);
  }
  console.log(`📍 Bar: ${bar.name}\n`);

  // Range last 30 days (UTC)
  const day = 24 * 60 * 60 * 1000;
  const to = new Date();
  const from = new Date(to.getTime() - 30 * day);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  console.log(`📅 Range: ${fromIso.slice(0, 10)} → ${toIso.slice(0, 10)}\n`);

  // 1. admin_sales_summary
  console.log("💰 admin_sales_summary");
  const summary = (await db.execute(
    sql`SELECT * FROM admin_sales_summary(${bar.id}::uuid, ${fromIso}::timestamptz, ${toIso}::timestamptz)`
  )) as unknown as Array<{
    total_revenue: string;
    transaction_count: number;
    unique_visitors: number;
  }>;
  const s0 = summary[0];
  console.log(
    `   ✅ revenue: ${s0?.total_revenue ?? 0}, tx: ${s0?.transaction_count ?? 0}, visitors: ${s0?.unique_visitors ?? 0}`
  );

  // 2. admin_top_items
  console.log("\n🥇 admin_top_items");
  const top = (await db.execute(
    sql`SELECT * FROM admin_top_items(${bar.id}::uuid, ${fromIso}::timestamptz, ${toIso}::timestamptz, 5)`
  )) as unknown as Array<{ name: string; total_qty: string; total_revenue: string }>;
  console.log(`   ✅ ${top.length} top items`);
  for (const t of top.slice(0, 3)) {
    console.log(`      - ${t.name}: qty ${t.total_qty}, revenue ${t.total_revenue}`);
  }

  // 3. admin_sales_by_hour
  console.log("\n⏰ admin_sales_by_hour");
  const byHour = (await db.execute(
    sql`SELECT * FROM admin_sales_by_hour(${bar.id}::uuid, ${fromIso}::timestamptz, ${toIso}::timestamptz)`
  )) as unknown as Array<{ hour_of_day: number; total_revenue: string }>;
  console.log(`   ✅ ${byHour.length} hours with sales`);

  // 4. admin_sales_by_day
  console.log("\n📆 admin_sales_by_day");
  const byDay = (await db.execute(
    sql`SELECT * FROM admin_sales_by_day(${bar.id}::uuid, ${fromIso}::timestamptz, ${toIso}::timestamptz)`
  )) as unknown as Array<{ sale_date: Date; total_revenue: string }>;
  console.log(`   ✅ ${byDay.length} days with sales`);

  // 5. admin_payment_methods
  console.log("\n💳 admin_payment_methods");
  const methods = (await db.execute(
    sql`SELECT * FROM admin_payment_methods(${bar.id}::uuid, ${fromIso}::timestamptz, ${toIso}::timestamptz)`
  )) as unknown as Array<{ method: string; total_amount: string; pct_share: string }>;
  console.log(`   ✅ ${methods.length} payment methods`);

  // 6. admin_transactions
  console.log("\n🧾 admin_transactions");
  const tx = (await db.execute(
    sql`SELECT * FROM admin_transactions(${bar.id}::uuid, ${fromIso}::timestamptz, ${toIso}::timestamptz, 5, 0)`
  )) as unknown as Array<{
    session_id: string;
    table_label: string;
    host_name: string;
    subtotal: string;
    duration_minutes: number;
  }>;
  console.log(`   ✅ ${tx.length} transactions`);
  for (const t of tx.slice(0, 3)) {
    console.log(`      - ${t.host_name} @ ${t.table_label}: ${t.subtotal} (${t.duration_minutes}min)`);
  }

  console.log("\n🎉 All admin RPC functions accessible via Drizzle!");
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n❌ Test failed:", err);
  await client.end();
  process.exit(1);
});
