/**
 * RESET DEV — hapus semua data order/sesi + menu supaya bisa import ulang
 * dengan struktur sub-kategori. HANYA untuk DB lokal/dev.
 *
 * Run: npx tsx scripts/reset-menu-dev.ts
 *
 * Guard: menolak jalan kalau host DB bukan localhost/127.0.0.1.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const u = new URL(DATABASE_URL);
console.log(`🔌 Target DB: ${u.hostname}:${u.port}${u.pathname}`);
if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) {
  console.error(
    `❌ Host "${u.hostname}" bukan lokal — dibatalkan (aman dari production).`
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function count(table: string): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM ${sql(table)}`;
  return rows[0].n as number;
}

const TABLES = [
  "table_sessions",
  "orders",
  "order_items",
  "payments",
  "menu_items",
  "menu_categories",
];

async function main() {
  console.log("\n== SEBELUM ==");
  for (const t of TABLES) console.log(`  ${t}: ${await count(t)}`);

  console.log("\n🧹 Menghapus… (transaksi)");
  await sql.begin(async (tx) => {
    // Hapus sesi meja → cascade: orders, order_items, payments,
    // session_members, session_invites, move_requests, dst.
    await tx`TRUNCATE TABLE "table_sessions" CASCADE`;
    // Menu: cascade menu_categories → menu_items (& sub-kategori via parent_id).
    await tx`TRUNCATE TABLE "menu_categories" CASCADE`;
  });

  console.log("\n== SESUDAH ==");
  for (const t of TABLES) console.log(`  ${t}: ${await count(t)}`);

  await sql.end();
  console.log("\n✅ Reset selesai. Silakan import menu baru via admin.");
}

main().catch(async (err) => {
  console.error("❌ Gagal:", err);
  await sql.end();
  process.exit(1);
});
