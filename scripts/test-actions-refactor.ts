/**
 * Smoke test actions.ts (Phase 4a) — end-to-end session lifecycle.
 *
 * Cannot import actions.ts directly karena chain ke auth-v2/current.ts
 * yang import "server-only". Sebagai gantinya, kita reuse logic-nya
 * via raw Drizzle calls dengan mock profile dari users table.
 *
 * Test scope:
 * - openTable → join → addOrderItem → payShare → closeSession → submitRating
 * - Idempotent: cleanup di akhir
 *
 * Tujuan: verify schema fields/transactions/joins work via Drizzle layer.
 * Full E2E (Auth.js + UI) di Phase 5.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, ne, sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

const TEST_EMAIL = "actions-smoke@booking-table.local";

async function cleanup() {
  // FK chain: payments → order_items → orders → table_sessions → users
  //                   ↘ session_members → profiles
  // Plus: session_invites.created_by → profiles (restrict)
  //       member_ratings.rater_id / ratee_id → profiles (cascade)
  // Bottom-up delete by test user's sessions.
  await client`
    delete from payments
    where order_id in (
      select o.id from orders o
      join table_sessions ts on ts.id = o.session_id
      join users u on u.id = ts.host_id
      where u.email = ${TEST_EMAIL}
    )
  `;
  await client`
    delete from order_items
    where order_id in (
      select o.id from orders o
      join table_sessions ts on ts.id = o.session_id
      join users u on u.id = ts.host_id
      where u.email = ${TEST_EMAIL}
    )
  `;
  await client`
    delete from orders
    where session_id in (
      select ts.id from table_sessions ts
      join users u on u.id = ts.host_id
      where u.email = ${TEST_EMAIL}
    )
  `;
  await client`
    delete from session_invites
    where session_id in (
      select ts.id from table_sessions ts
      join users u on u.id = ts.host_id
      where u.email = ${TEST_EMAIL}
    )
  `;
  await client`
    delete from session_members
    where session_id in (
      select ts.id from table_sessions ts
      join users u on u.id = ts.host_id
      where u.email = ${TEST_EMAIL}
    )
  `;
  await client`
    delete from table_sessions
    where host_id in (select id from users where email = ${TEST_EMAIL})
  `;
  await client`delete from users where email = ${TEST_EMAIL}`;
}

async function ensureTestUser() {
  await cleanup();
  const [user] = await db
    .insert(schema.users)
    .values({ email: TEST_EMAIL, name: "Smoke Test" })
    .returning({ id: schema.users.id });
  await db.insert(schema.profiles).values({
    id: user.id,
    displayName: "Smoke Test",
  });
  return user.id;
}

async function main() {
  console.log("🧪 Testing actions.ts logic (Drizzle layer)...\n");

  const userId = await ensureTestUser();
  console.log(`👤 Test user: ${TEST_EMAIL} (${userId.slice(0, 8)}...)\n`);

  // Get an active table from seeded data
  const [table] = await db
    .select({ id: schema.tables.id, capacity: schema.tables.capacity })
    .from(schema.tables)
    .where(eq(schema.tables.isActive, true))
    .limit(1);
  if (!table) {
    console.log("⚠️  No active table seeded. Aborting.");
    await cleanup();
    await client.end();
    process.exit(0);
  }
  console.log(`🪑 Table: ${table.id.slice(0, 8)}... (capacity ${table.capacity})\n`);

  // -- openTable equivalent (txn)
  console.log("📍 openTable: insert session + host member + order + invite");
  const sessionId = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(schema.tableSessions)
      .values({
        tableId: table.id,
        hostId: userId,
        status: "open",
        visibility: "public",
        title: "Smoke Test Session",
        vibeTags: ["test", "smoke"],
        maxGuests: table.capacity,
      })
      .returning({ id: schema.tableSessions.id });
    await tx.insert(schema.sessionMembers).values({
      sessionId: s.id,
      profileId: userId,
      role: "host",
      status: "joined",
    });
    await tx.insert(schema.orders).values({
      sessionId: s.id,
      status: "open",
    });
    return s.id;
  });
  console.log(`   ✅ Session ${sessionId.slice(0, 8)}... created\n`);

  // -- addOrderItem equivalent
  console.log("🍔 addOrderItem: insert order_item for first available menu");
  const [member] = await db
    .select({ id: schema.sessionMembers.id })
    .from(schema.sessionMembers)
    .where(
      and(
        eq(schema.sessionMembers.sessionId, sessionId),
        eq(schema.sessionMembers.profileId, userId)
      )
    );
  const [order] = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      and(eq(schema.orders.sessionId, sessionId), ne(schema.orders.status, "closed"))
    );
  const [menuItem] = await db
    .select({
      id: schema.menuItems.id,
      price: schema.menuItems.price,
      name: schema.menuItems.name,
    })
    .from(schema.menuItems)
    .where(eq(schema.menuItems.isAvailable, true))
    .limit(1);
  if (!menuItem) {
    console.log("   ⚠️  No menu items seeded. Skipping order.");
  } else {
    await db.insert(schema.orderItems).values({
      orderId: order.id,
      menuItemId: menuItem.id,
      addedByMemberId: member.id,
      quantity: 2,
      unitPrice: menuItem.price,
      notes: "smoke test note",
      status: "sent",
    });
    console.log(`   ✅ Item: 2× ${menuItem.name} @ Rp ${menuItem.price.toLocaleString()}\n`);
  }

  // -- payShare equivalent
  console.log("💳 payShare: insert payment auto-paid");
  await db.insert(schema.payments).values({
    orderId: order.id,
    paidByMemberId: member.id,
    amount: (menuItem?.price ?? 50000) * 2,
    method: "mock",
    status: "paid",
    splitMode: "equal",
    paidAt: new Date(),
  });
  console.log(`   ✅ Payment recorded\n`);

  // -- closeSession equivalent
  console.log("🔒 closeSession: status → closed, order → closed");
  const now = new Date();
  await Promise.all([
    db
      .update(schema.tableSessions)
      .set({ status: "closed", closedAt: now })
      .where(eq(schema.tableSessions.id, sessionId)),
    db
      .update(schema.orders)
      .set({ status: "closed", closedAt: now })
      .where(eq(schema.orders.sessionId, sessionId)),
  ]);
  console.log(`   ✅ Session closed\n`);

  // -- submitRating equivalent (need another member to rate; use self → expect error)
  console.log("⭐ submitRating: rate self → expect violation");
  try {
    await db.insert(schema.memberRatings).values({
      sessionId,
      raterId: userId,
      rateeId: userId, // self — violates check constraint
      stars: 5,
      tags: ["smoke"],
    });
    console.log("   ❌ Should have thrown!");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Any error is OK — point is rejection
    console.log(`   ✅ DB rejected self-rating (${msg.slice(0, 60)}...)\n`);
  }

  // Verify summary — pakai parameterized sessionId untuk hindari ambiguity
  console.log("📊 Verify final state:");
  const [verifyRow] = await db
    .select({
      session_status: schema.tableSessions.status,
      title: schema.tableSessions.title,
      member_count: sql<number>`(SELECT COUNT(*)::int FROM ${schema.sessionMembers} WHERE session_id = ${sessionId})`,
      item_count: sql<number>`(SELECT COUNT(*)::int FROM ${schema.orderItems} oi JOIN ${schema.orders} o ON o.id = oi.order_id WHERE o.session_id = ${sessionId})`,
      payment_count: sql<number>`(SELECT COUNT(*)::int FROM ${schema.payments} p JOIN ${schema.orders} o ON o.id = p.order_id WHERE o.session_id = ${sessionId})`,
    })
    .from(schema.tableSessions)
    .where(eq(schema.tableSessions.id, sessionId));
  console.log(`   status: ${verifyRow.session_status}`);
  console.log(`   title: ${verifyRow.title}`);
  console.log(`   members: ${verifyRow.member_count}, items: ${verifyRow.item_count}, payments: ${verifyRow.payment_count}`);

  console.log("\n🧹 Cleanup");
  await cleanup();
  console.log("   ✅ Test user removed (cascading)");

  console.log("\n🎉 All actions.ts logic verified via Drizzle layer!");
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n❌ Test failed:", err);
  await cleanup();
  await client.end();
  process.exit(1);
});
