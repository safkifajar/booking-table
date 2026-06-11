/**
 * Smoke test untuk Credentials provider flow:
 *
 * 1. Signup user baru (create user + profile)
 * 2. Lookup user by email (verify DB state)
 * 3. Verify password dengan bcrypt
 * 4. Duplicate signup attempt (harus throw email_taken)
 * 5. Wrong password (verify return false)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { signup, SignupError } from "../src/lib/auth-v2/signup";
import { verifyPassword } from "../src/lib/auth-v2/password";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

const TEST_EMAIL = `test-${Date.now()}@booking-table.local`;
const TEST_PASSWORD = "secret123";
const TEST_NAME = "Test User";

async function cleanup() {
  // Hapus test user (cascade delete ke profile)
  await client`delete from users where email like 'test-%@booking-table.local'`;
}

async function main() {
  console.log("🔐 Testing Credentials provider...\n");

  // Cleanup dulu
  await cleanup();
  console.log("✅ Cleanup old test users");

  // 1. Signup
  console.log(`\n📝 Test 1: Signup ${TEST_EMAIL}`);
  const result = await signup({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    displayName: TEST_NAME,
  });
  console.log(`   ✅ User created: id=${result.userId.slice(0, 8)}...`);

  // 2. Verify user + profile created
  console.log("\n🔍 Test 2: Verify DB state");
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, TEST_EMAIL),
  });
  if (!user) throw new Error("User not found in DB");
  console.log(`   ✅ User: ${user.email}`);
  console.log(`   ✅ Has password hash: ${user.passwordHash?.length} chars`);

  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.id, user.id),
  });
  if (!profile) throw new Error("Profile not auto-created");
  console.log(`   ✅ Profile: ${profile.displayName}`);

  // 3. Verify password (positive)
  console.log("\n🔓 Test 3: Verify correct password");
  const ok = await verifyPassword(TEST_PASSWORD, user.passwordHash);
  if (!ok) throw new Error("Password verification failed (should pass)");
  console.log("   ✅ Correct password accepted");

  // 4. Verify wrong password (negative)
  console.log("\n❌ Test 4: Reject wrong password");
  const fail = await verifyPassword("wrongpass", user.passwordHash);
  if (fail) throw new Error("Wrong password was accepted (should reject)");
  console.log("   ✅ Wrong password rejected");

  // 5. Duplicate signup → harus throw
  console.log("\n🚫 Test 5: Duplicate email signup");
  try {
    await signup({
      email: TEST_EMAIL,
      password: "anotherpass",
      displayName: "Another User",
    });
    throw new Error("Duplicate signup should have failed");
  } catch (err) {
    if (err instanceof SignupError && err.code === "email_taken") {
      console.log("   ✅ Duplicate rejected with email_taken error");
    } else {
      throw err;
    }
  }

  // 6. Cleanup
  console.log("\n🧹 Cleanup");
  await cleanup();
  console.log("   ✅ Test users removed");

  await client.end();
  console.log("\n🎉 All Credentials tests passed!");
}

main().catch(async (err) => {
  console.error("\n❌ Test failed:", err);
  await cleanup();
  await client.end();
  process.exit(1);
});
