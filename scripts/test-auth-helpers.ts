/**
 * Smoke test untuk server helpers (getCurrentProfile, requireAdmin, dll).
 *
 * Limit test: auth() dari Auth.js butuh Next.js request context (cookie),
 * jadi kita TIDAK bisa test full helper dari CLI. Yang kita test:
 *
 * 1. Schema integrity — query yang sama dengan helper bisa jalan
 * 2. Signup → profile fetch flow (path tanpa auth context)
 * 3. Staff role lookup logic
 *
 * E2E full flow (signin via browser → cookie set → helper return real session)
 * akan di-cover di step 8.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { signup } from "../src/lib/auth-v2/signup";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

const TEST_EMAIL = `helper-${Date.now()}@booking-table.local`;
const TEST_PASSWORD = "secret123";
const TEST_NAME = "Helper Test";

async function cleanup() {
  await client`delete from users where email like 'helper-%@booking-table.local'`;
}

async function main() {
  console.log("🧪 Testing server helpers query layer...\n");

  await cleanup();
  console.log("✅ Cleanup old test users");

  // 1. Signup creates user + profile in transaction
  console.log("\n📝 Test 1: Signup creates user + profile");
  const { userId } = await signup({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    displayName: TEST_NAME,
  });
  console.log(`   ✅ User created: ${userId.slice(0, 8)}...`);

  // 2. Profile lookup (path dari getCurrentProfile)
  console.log("\n🔍 Test 2: Profile lookup by user id (mirror getCurrentProfile)");
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.id, userId),
  });
  if (!profile) throw new Error("Profile not found");
  console.log(`   ✅ Profile.displayName: ${profile.displayName}`);
  console.log(`   ✅ Profile.hobbies: [${profile.hobbies.join(", ") || "empty"}]`);

  // 3. Staff role lookup (path dari requireAdmin)
  console.log("\n👔 Test 3: Staff role lookup (mirror requireAdmin)");
  const noRole = await db.query.staffRoles.findFirst({
    where: and(
      eq(schema.staffRoles.profileId, userId),
      eq(schema.staffRoles.isActive, true),
      inArray(schema.staffRoles.role, ["admin", "manager"])
    ),
  });
  if (noRole) throw new Error("New user should NOT have staff role");
  console.log("   ✅ New user has no staff role (correctly null)");

  // 4. Promote to manager → re-check
  console.log("\n👑 Test 4: Promote user to manager + re-check");
  const bar = await db.query.bars.findFirst({
    where: eq(schema.bars.slug, "soho-purwokerto"),
  });
  if (!bar) throw new Error("Bar 'soho-purwokerto' not seeded");

  await db.insert(schema.staffRoles).values({
    barId: bar.id,
    profileId: userId,
    role: "manager",
    isActive: true,
  });

  const withRole = await db.query.staffRoles.findFirst({
    where: and(
      eq(schema.staffRoles.profileId, userId),
      eq(schema.staffRoles.isActive, true),
      inArray(schema.staffRoles.role, ["admin", "manager"])
    ),
    with: {
      bar: {
        columns: { id: true, slug: true, name: true },
      },
    },
  });
  if (!withRole) throw new Error("Staff role should exist after insert");
  console.log(`   ✅ Role: ${withRole.role}`);
  console.log(`   ✅ Bar: ${withRole.bar.name} (${withRole.bar.slug})`);

  // 5. Cleanup
  console.log("\n🧹 Cleanup");
  await cleanup();
  console.log("   ✅ Test users removed");

  await client.end();
  console.log("\n🎉 All helper tests passed!");
  console.log("ℹ️  Full E2E (cookie-based session) akan di-test via browser di step 8");
}

main().catch(async (err) => {
  console.error("\n❌ Test failed:", err);
  await cleanup();
  await client.end();
  process.exit(1);
});
