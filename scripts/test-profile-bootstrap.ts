/**
 * Smoke test untuk bootstrapProfile — dipakai di Auth.js events.createUser.
 *
 * Scenarios:
 * 1. Create user (no profile) → bootstrap → profile ada dengan default name
 * 2. Bootstrap lagi → idempotent (no-op)
 * 3. Default name dari email
 * 4. Default name dari `name` field (lebih prefer ini)
 * 5. Fallback "Guest" kalau email + name keduanya null
 * 6. Long email/name truncated 40 chars
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { bootstrapProfile } from "../src/lib/auth-v2/profile-bootstrap";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

async function createBareUser(email: string) {
  const [u] = await db
    .insert(schema.users)
    .values({ email })
    .returning({ id: schema.users.id });
  return u.id;
}

async function cleanup() {
  await client`delete from users where email like 'bootstrap-%@booking-table.local'`;
}

async function main() {
  console.log("🧪 Testing bootstrapProfile...\n");

  await cleanup();
  console.log("✅ Cleanup old test users");

  // 1. Bootstrap baru → create profile dengan default name dari email
  console.log("\n📝 Test 1: Bootstrap creates profile from email");
  const uid1 = await createBareUser("bootstrap-1-foo@booking-table.local");
  await bootstrapProfile({ userId: uid1, email: "bootstrap-1-foo@booking-table.local" });
  const p1 = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, uid1) });
  if (!p1) throw new Error("Profile not created");
  if (p1.displayName !== "bootstrap-1-foo") {
    throw new Error(`Expected displayName "bootstrap-1-foo", got "${p1.displayName}"`);
  }
  console.log(`   ✅ Profile.displayName: "${p1.displayName}" (from email)`);

  // 2. Idempotent — bootstrap lagi, profile tidak berubah
  console.log("\n🔁 Test 2: Idempotent (re-bootstrap = no-op)");
  await bootstrapProfile({ userId: uid1, email: "different@example.com", name: "Different Name" });
  const p1Again = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, uid1) });
  if (p1Again?.displayName !== "bootstrap-1-foo") {
    throw new Error("Profile was modified on second bootstrap (should be idempotent)");
  }
  console.log(`   ✅ Second bootstrap did not overwrite ("${p1Again.displayName}" unchanged)`);

  // 3. Prefer `name` over email
  console.log("\n👤 Test 3: Prefer name field over email");
  const uid2 = await createBareUser("bootstrap-2-bar@booking-table.local");
  await bootstrapProfile({
    userId: uid2,
    email: "bootstrap-2-bar@booking-table.local",
    name: "Display Name From OAuth",
  });
  const p2 = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, uid2) });
  if (p2?.displayName !== "Display Name From OAuth") {
    throw new Error(`Expected displayName "Display Name From OAuth", got "${p2?.displayName}"`);
  }
  console.log(`   ✅ Profile.displayName: "${p2.displayName}" (prefer name)`);

  // 4. Fallback Guest kalau email + name keduanya null
  console.log("\n👻 Test 4: Fallback 'Guest' kalau no email/name");
  const uid3 = await createBareUser("bootstrap-3-baz@booking-table.local");
  await bootstrapProfile({ userId: uid3 });
  const p3 = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, uid3) });
  if (p3?.displayName !== "Guest") {
    throw new Error(`Expected "Guest", got "${p3?.displayName}"`);
  }
  console.log(`   ✅ Profile.displayName: "${p3.displayName}" (fallback)`);

  // 5. Truncate >40 chars
  console.log("\n✂️  Test 5: Truncate displayName ke 40 chars");
  const uid4 = await createBareUser("bootstrap-4-long@booking-table.local");
  const veryLongName = "A".repeat(100);
  await bootstrapProfile({ userId: uid4, name: veryLongName });
  const p4 = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, uid4) });
  if (p4?.displayName.length !== 40) {
    throw new Error(`Expected 40 chars, got ${p4?.displayName.length}`);
  }
  console.log(`   ✅ Profile.displayName: ${p4.displayName.length} chars (truncated)`);

  console.log("\n🧹 Cleanup");
  await cleanup();
  console.log("   ✅ Test users removed");

  await client.end();
  console.log("\n🎉 All bootstrap tests passed!");
}

main().catch(async (err) => {
  console.error("\n❌ Test failed:", err);
  await cleanup();
  await client.end();
  process.exit(1);
});
