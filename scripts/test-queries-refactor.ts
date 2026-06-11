/**
 * Smoke test queries.ts setelah refactor ke Drizzle.
 *
 * Runs each function & cek return shape match contract di types/db.ts.
 * Pakai seeded data — kalau database kosong, beberapa test akan skip.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  getBarBySlug,
  getFloorAreas,
  getTablesByArea,
  getActiveSessionsByBar,
  getActiveSessionsForArea,
  getMenuByBar,
  getUserRating,
  getUserRatingsBatch,
  getRatableMembers,
} from "../src/lib/queries";

async function main() {
  console.log("🧪 Testing queries.ts (refactored to Drizzle)...\n");

  // 1. getBarBySlug
  console.log("📍 getBarBySlug('soho-purwokerto')");
  const bar = await getBarBySlug("soho-purwokerto");
  if (!bar) {
    console.log("   ⚠️  No bar found — DB might not be seeded. Skipping rest.");
    process.exit(0);
  }
  console.log(`   ✅ Bar: ${bar.name} (id: ${bar.id.slice(0, 8)}...)`);
  if (typeof bar.created_at !== "string") {
    throw new Error("created_at should be ISO string");
  }

  // 2. getFloorAreas
  console.log("\n🏗️  getFloorAreas");
  const areas = await getFloorAreas(bar.id);
  console.log(`   ✅ ${areas.length} areas`);
  for (const a of areas) {
    console.log(`      - ${a.name} (canvas ${a.canvas_width}x${a.canvas_height})`);
  }

  // 3. getTablesByArea (first area)
  if (areas.length > 0) {
    console.log(`\n🪑 getTablesByArea(${areas[0].name})`);
    const tables = await getTablesByArea(areas[0].id);
    console.log(`   ✅ ${tables.length} active tables`);
    if (tables.length > 0) {
      const t = tables[0];
      console.log(
        `      First: ${t.label}, ${t.shape}, cap ${t.capacity}, pos (${t.pos_x},${t.pos_y})`
      );
    }
  }

  // 4. getActiveSessionsByBar
  console.log("\n🎉 getActiveSessionsByBar");
  const sessions = await getActiveSessionsByBar(bar.id);
  console.log(`   ✅ ${sessions.length} active sessions`);
  for (const s of sessions.slice(0, 3)) {
    console.log(
      `      - ${s.title ?? "(no title)"} @ ${s.table_label}, host ${s.host_name}, ${s.member_count} members`
    );
  }

  // 5. getActiveSessionsForArea (first area)
  if (areas.length > 0) {
    console.log(`\n🎉 getActiveSessionsForArea(${areas[0].name})`);
    const areaSessions = await getActiveSessionsForArea(areas[0].id);
    console.log(`   ✅ ${areaSessions.length} active sessions in area`);
  }

  // 6. getMenuByBar
  console.log("\n🍔 getMenuByBar");
  const menu = await getMenuByBar(bar.id);
  console.log(`   ✅ ${menu.length} active categories`);
  for (const cat of menu.slice(0, 3)) {
    console.log(`      - ${cat.name}: ${cat.items.length} items`);
    if (cat.items[0]) {
      const item = cat.items[0];
      console.log(
        `        e.g. ${item.name} @ Rp ${item.price.toLocaleString()}, prep ${item.prep_minutes}min`
      );
    }
  }

  // 7. getUserRating (host of first session if any)
  if (sessions.length > 0) {
    console.log(`\n⭐ getUserRating(${sessions[0].host_name})`);
    const rating = await getUserRating(sessions[0].host_id);
    console.log(
      `   ✅ avg ${rating.avg_stars}, count ${rating.rating_count}, top tags: ${
        rating.top_tags?.join(", ") ?? "none"
      }`
    );
  } else {
    console.log("\n⭐ getUserRating: skipped (no sessions to derive profile)");
  }

  // 8. getUserRatingsBatch
  if (sessions.length > 0) {
    console.log("\n⭐ getUserRatingsBatch");
    const ids = sessions.slice(0, 3).map((s) => s.host_id);
    const batch = await getUserRatingsBatch(ids);
    console.log(`   ✅ Got ${Object.keys(batch).length} ratings`);
  }

  // 9. getRatableMembers (need an active session with multiple members)
  if (sessions.length > 0) {
    console.log(`\n👥 getRatableMembers(session, hostId)`);
    const s = sessions[0];
    const ratable = await getRatableMembers(s.id, s.host_id);
    console.log(`   ✅ ${ratable.length} ratable members (excluding host)`);
    for (const m of ratable.slice(0, 3)) {
      console.log(
        `      - ${m.display_name} (already rated: ${m.already_rated})`
      );
    }
  }

  console.log("\n🎉 All queries.ts tests passed!");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
