/**
 * Smoke test SSE realtime: LISTEN/NOTIFY round-trip via Postgres.
 *
 * Verify:
 * 1. Bisa LISTEN ke channel
 * 2. Bisa pg_notify dari client lain
 * 3. Listener menerima notification
 *
 * Tidak test HTTP endpoint (butuh auth cookie + browser); cuma layer DB.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const TEST_CHANNEL = "test:smoke";

async function main() {
  console.log("🧪 Testing SSE realtime layer (LISTEN/NOTIFY)...\n");

  // 2 connections: listener + notifier
  const listenerClient = postgres(process.env.DATABASE_URL!, {
    max: 1,
    idle_timeout: 0,
  });
  const notifierClient = postgres(process.env.DATABASE_URL!, { max: 1 });

  const received: string[] = [];
  let resolveFirst: ((v: void) => void) | null = null;
  const firstReceived = new Promise<void>((r) => (resolveFirst = r));

  console.log("📡 LISTEN test:smoke");
  const sub = await listenerClient.listen(TEST_CHANNEL, (payload) => {
    console.log(`   📥 Received: ${payload}`);
    received.push(payload);
    if (received.length === 1 && resolveFirst) resolveFirst();
  });

  // Wait a moment for subscription ready
  await new Promise((r) => setTimeout(r, 200));

  console.log("\n📤 NOTIFY test:smoke (1st)");
  await notifierClient`SELECT pg_notify(${TEST_CHANNEL}, ${'{"event":"hello"}'})`;

  // Wait for first message (max 2s)
  await Promise.race([
    firstReceived,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout: notification not received in 2s")), 2000)),
  ]);
  console.log("   ✅ First notification round-trip OK");

  console.log("\n📤 NOTIFY test:smoke (2nd)");
  await notifierClient`SELECT pg_notify(${TEST_CHANNEL}, ${'{"event":"second"}'})`;
  await new Promise((r) => setTimeout(r, 200));

  if (received.length < 2) {
    throw new Error(`Expected ≥2 notifications, got ${received.length}`);
  }
  console.log(`   ✅ ${received.length} notifications received total`);

  // Cleanup
  await sub.unlisten();
  await listenerClient.end();
  await notifierClient.end();

  console.log("\n🎉 LISTEN/NOTIFY layer works!");
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n❌ Test failed:", err.message ?? err);
  process.exit(1);
});
