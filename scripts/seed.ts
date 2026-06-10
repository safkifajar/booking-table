/**
 * Seed script — populate fresh database with SOHO Social House master data.
 *
 * Run:
 *   npx tsx scripts/seed.ts
 *
 * IDEMPOTENT: aman dijalankan ulang. Akan skip bar yang sudah ada by slug.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const BAR_SLUG = "soho-purwokerto";

async function main() {
  console.log("🌱 Seeding SOHO Social House...\n");

  // Cek apakah bar sudah ada
  const existing = await db.query.bars.findFirst({
    where: eq(schema.bars.slug, BAR_SLUG),
  });

  if (existing) {
    console.log(`⏭️  Bar "${BAR_SLUG}" sudah ada (id=${existing.id}), skip seed.`);
    console.log("   Untuk reset: DROP & re-create bar lewat Adminer atau drizzle-kit push --force.");
    await client.end();
    return;
  }

  // ============================================================
  // 1. BAR
  // ============================================================
  const [bar] = await db
    .insert(schema.bars)
    .values({
      slug: BAR_SLUG,
      name: "SOHO Social House",
      tagline: "Where the night begins",
      address: "Jl. Jend. Soedirman, Purwokerto, Jawa Tengah",
      theme: {
        primary: "#C9A961",
        accent: "#1A1A1A",
        bg: "#0A0A0A",
      },
      openingHours: {
        mon: "17:00-01:00",
        tue: "17:00-01:00",
        wed: "17:00-01:00",
        thu: "17:00-02:00",
        fri: "17:00-03:00",
        sat: "17:00-03:00",
        sun: "17:00-01:00",
      },
    })
    .returning();
  console.log(`✅ Bar: ${bar.name} (${bar.id})`);

  // ============================================================
  // 2. FLOOR AREAS
  // ============================================================
  const [indoorArea, rooftopArea] = await db
    .insert(schema.floorAreas)
    .values([
      {
        barId: bar.id,
        name: "Indoor Lounge",
        slug: "indoor",
        canvasWidth: 900,
        canvasHeight: 600,
        sortOrder: 0,
      },
      {
        barId: bar.id,
        name: "Rooftop",
        slug: "rooftop",
        canvasWidth: 900,
        canvasHeight: 600,
        sortOrder: 1,
      },
    ])
    .returning();
  console.log(`✅ Floor areas: 2 (Indoor, Rooftop)`);

  // ============================================================
  // 3. TABLES — Indoor (12) + Rooftop (12) = 24 tables
  // ============================================================
  const indoorTables = [
    // Booth area (kanan) — kapasitas besar
    { label: "B1", shape: "booth" as const, capacity: 6, posX: 720, posY: 80, width: 140, height: 100, minSpend: 500_000 },
    { label: "B2", shape: "booth" as const, capacity: 6, posX: 720, posY: 220, width: 140, height: 100, minSpend: 500_000 },
    { label: "B3", shape: "booth" as const, capacity: 6, posX: 720, posY: 360, width: 140, height: 100, minSpend: 500_000 },
    // Round tables (tengah)
    { label: "T1", shape: "round" as const, capacity: 4, posX: 380, posY: 130, width: 90, height: 90 },
    { label: "T2", shape: "round" as const, capacity: 4, posX: 510, posY: 130, width: 90, height: 90 },
    { label: "T3", shape: "round" as const, capacity: 4, posX: 380, posY: 280, width: 90, height: 90 },
    { label: "T4", shape: "round" as const, capacity: 4, posX: 510, posY: 280, width: 90, height: 90 },
    { label: "T5", shape: "round" as const, capacity: 2, posX: 380, posY: 430, width: 70, height: 70 },
    { label: "T6", shape: "round" as const, capacity: 2, posX: 510, posY: 430, width: 70, height: 70 },
    // Bar counter seats (kiri)
    { label: "BC1", shape: "square" as const, capacity: 2, posX: 100, posY: 100, width: 60, height: 60 },
    { label: "BC2", shape: "square" as const, capacity: 2, posX: 100, posY: 200, width: 60, height: 60 },
    { label: "BC3", shape: "square" as const, capacity: 2, posX: 100, posY: 300, width: 60, height: 60 },
    { label: "BC4", shape: "square" as const, capacity: 2, posX: 100, posY: 400, width: 60, height: 60 },
  ];

  const rooftopTables = [
    // Lounge sofas (atas) — kapasitas 8
    { label: "R-L1", shape: "rect" as const, capacity: 8, posX: 80, posY: 80, width: 180, height: 120, minSpend: 750_000 },
    { label: "R-L2", shape: "rect" as const, capacity: 8, posX: 290, posY: 80, width: 180, height: 120, minSpend: 750_000 },
    { label: "R-L3", shape: "rect" as const, capacity: 8, posX: 500, posY: 80, width: 180, height: 120, minSpend: 750_000 },
    // Round tables (tengah)
    { label: "R-T1", shape: "round" as const, capacity: 4, posX: 130, posY: 270, width: 90, height: 90 },
    { label: "R-T2", shape: "round" as const, capacity: 4, posX: 260, posY: 270, width: 90, height: 90 },
    { label: "R-T3", shape: "round" as const, capacity: 4, posX: 390, posY: 270, width: 90, height: 90 },
    { label: "R-T4", shape: "round" as const, capacity: 4, posX: 520, posY: 270, width: 90, height: 90 },
    { label: "R-T5", shape: "round" as const, capacity: 4, posX: 650, posY: 270, width: 90, height: 90 },
    // VIP cabana
    { label: "VIP", shape: "booth" as const, capacity: 10, posX: 700, posY: 420, width: 180, height: 140, minSpend: 1_500_000 },
    // Standing tables (bawah)
    { label: "R-S1", shape: "round" as const, capacity: 2, posX: 130, posY: 470, width: 70, height: 70 },
    { label: "R-S2", shape: "round" as const, capacity: 2, posX: 240, posY: 470, width: 70, height: 70 },
    { label: "R-S3", shape: "round" as const, capacity: 2, posX: 350, posY: 470, width: 70, height: 70 },
    { label: "R-S4", shape: "round" as const, capacity: 2, posX: 460, posY: 470, width: 70, height: 70 },
  ];

  await db.insert(schema.tables).values(
    indoorTables.map((t) => ({ ...t, areaId: indoorArea.id }))
  );
  await db.insert(schema.tables).values(
    rooftopTables.map((t) => ({ ...t, areaId: rooftopArea.id }))
  );
  console.log(`✅ Tables: ${indoorTables.length} indoor + ${rooftopTables.length} rooftop = 24 total`);

  // ============================================================
  // 4. MENU CATEGORIES + ITEMS
  // ============================================================
  const categories = await db
    .insert(schema.menuCategories)
    .values([
      { barId: bar.id, name: "Signature Cocktails", slug: "signature", sortOrder: 0 },
      { barId: bar.id, name: "Classic Cocktails", slug: "classic", sortOrder: 1 },
      { barId: bar.id, name: "Mocktails", slug: "mocktails", sortOrder: 2 },
      { barId: bar.id, name: "Wine & Spirits", slug: "wine", sortOrder: 3 },
      { barId: bar.id, name: "Beer", slug: "beer", sortOrder: 4 },
      { barId: bar.id, name: "Bar Bites", slug: "bites", sortOrder: 5 },
      { barId: bar.id, name: "Main Course", slug: "mains", sortOrder: 6 },
    ])
    .returning();
  console.log(`✅ Menu categories: ${categories.length}`);

  const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c.id]));

  const menuItems = [
    // Signature Cocktails
    { categoryId: catBySlug.signature, name: "SOHO Sunset", description: "Tequila, passionfruit, lime, hint of chili", price: 125_000, tags: ["signature", "alcoholic", "spicy"], prepMinutes: 6, sortOrder: 0 },
    { categoryId: catBySlug.signature, name: "Purwokerto Mule", description: "Vodka, ginger beer, kemangi infusion", price: 110_000, tags: ["signature", "alcoholic", "local"], prepMinutes: 5, sortOrder: 1 },
    { categoryId: catBySlug.signature, name: "Banyumas Old Fashioned", description: "Bourbon, palm sugar, smoked cinnamon bitters", price: 145_000, tags: ["signature", "alcoholic", "smoky"], prepMinutes: 7, sortOrder: 2 },
    { categoryId: catBySlug.signature, name: "Velvet Lounge", description: "Gin, butterfly pea, lychee, prosecco float", price: 130_000, tags: ["signature", "alcoholic", "floral"], prepMinutes: 5, sortOrder: 3 },
    // Classic Cocktails
    { categoryId: catBySlug.classic, name: "Negroni", description: "Gin, Campari, sweet vermouth", price: 95_000, tags: ["classic", "alcoholic", "bitter"], prepMinutes: 4, sortOrder: 0 },
    { categoryId: catBySlug.classic, name: "Margarita", description: "Tequila, triple sec, fresh lime, salt rim", price: 95_000, tags: ["classic", "alcoholic", "citrus"], prepMinutes: 4, sortOrder: 1 },
    { categoryId: catBySlug.classic, name: "Espresso Martini", description: "Vodka, kahlua, fresh espresso", price: 105_000, tags: ["classic", "alcoholic", "caffeine"], prepMinutes: 5, sortOrder: 2 },
    { categoryId: catBySlug.classic, name: "Mojito", description: "White rum, mint, lime, soda", price: 85_000, tags: ["classic", "alcoholic", "refreshing"], prepMinutes: 4, sortOrder: 3 },
    { categoryId: catBySlug.classic, name: "Whiskey Sour", description: "Bourbon, lemon, sugar, egg white", price: 100_000, tags: ["classic", "alcoholic"], prepMinutes: 5, sortOrder: 4 },
    // Mocktails
    { categoryId: catBySlug.mocktails, name: "Virgin Mojito", description: "Mint, lime, soda", price: 55_000, tags: ["non-alcoholic", "refreshing"], prepMinutes: 3, sortOrder: 0 },
    { categoryId: catBySlug.mocktails, name: "Tropical Sunrise", description: "Orange, mango, grenadine, soda", price: 60_000, tags: ["non-alcoholic", "fruity"], prepMinutes: 3, sortOrder: 1 },
    { categoryId: catBySlug.mocktails, name: "Lychee Spritz", description: "Lychee, sparkling water, basil", price: 65_000, tags: ["non-alcoholic", "floral"], prepMinutes: 3, sortOrder: 2 },
    // Wine & Spirits
    { categoryId: catBySlug.wine, name: "House Red (glass)", description: "Cabernet Sauvignon", price: 90_000, tags: ["wine", "red"], prepMinutes: 2, sortOrder: 0 },
    { categoryId: catBySlug.wine, name: "House White (glass)", description: "Sauvignon Blanc", price: 90_000, tags: ["wine", "white"], prepMinutes: 2, sortOrder: 1 },
    { categoryId: catBySlug.wine, name: "House Red (bottle)", description: "Cabernet Sauvignon", price: 450_000, tags: ["wine", "red", "bottle"], prepMinutes: 2, sortOrder: 2 },
    { categoryId: catBySlug.wine, name: "Prosecco (bottle)", description: "Italian sparkling", price: 550_000, tags: ["wine", "sparkling", "bottle"], prepMinutes: 2, sortOrder: 3 },
    { categoryId: catBySlug.wine, name: "Jack Daniel's Set", description: "Bottle + 4 mixers", price: 850_000, tags: ["spirit", "bottle", "whiskey"], prepMinutes: 3, sortOrder: 4 },
    { categoryId: catBySlug.wine, name: "Absolut Vodka Set", description: "Bottle + 4 mixers", price: 750_000, tags: ["spirit", "bottle", "vodka"], prepMinutes: 3, sortOrder: 5 },
    // Beer
    { categoryId: catBySlug.beer, name: "Bintang Pilsener", description: "Local lager", price: 45_000, tags: ["beer", "local"], prepMinutes: 1, sortOrder: 0 },
    { categoryId: catBySlug.beer, name: "Heineken", description: "Dutch lager", price: 55_000, tags: ["beer", "import"], prepMinutes: 1, sortOrder: 1 },
    { categoryId: catBySlug.beer, name: "Corona + lime", description: "Mexican lager with lime", price: 65_000, tags: ["beer", "import"], prepMinutes: 1, sortOrder: 2 },
    { categoryId: catBySlug.beer, name: "Stark Wheat IPA", description: "Local craft IPA", price: 70_000, tags: ["beer", "craft", "local"], prepMinutes: 1, sortOrder: 3 },
    // Bar Bites
    { categoryId: catBySlug.bites, name: "Truffle Fries", description: "Shoestring, truffle oil, parmesan", price: 75_000, tags: ["snack", "vegetarian"], prepMinutes: 10, sortOrder: 0 },
    { categoryId: catBySlug.bites, name: "Crispy Chicken Wings", description: "Korean glaze or BBQ", price: 85_000, tags: ["snack", "chicken"], prepMinutes: 12, sortOrder: 1 },
    { categoryId: catBySlug.bites, name: "Calamari Fritti", description: "Crispy squid, garlic aioli", price: 95_000, tags: ["snack", "seafood"], prepMinutes: 10, sortOrder: 2 },
    { categoryId: catBySlug.bites, name: "Beef Sliders (3pc)", description: "Mini wagyu burgers, brioche", price: 110_000, tags: ["snack", "beef"], prepMinutes: 14, sortOrder: 3 },
    { categoryId: catBySlug.bites, name: "Tuna Tartare", description: "Sashimi-grade tuna, avocado, chips", price: 125_000, tags: ["snack", "seafood", "raw"], prepMinutes: 10, sortOrder: 4 },
    { categoryId: catBySlug.bites, name: "Cheese & Charcuterie", description: "Selection of cheese & cold cuts", price: 185_000, tags: ["snack", "sharing"], prepMinutes: 8, sortOrder: 5 },
    { categoryId: catBySlug.bites, name: "Edamame", description: "Salted or spicy", price: 35_000, tags: ["snack", "vegetarian", "light"], prepMinutes: 5, sortOrder: 6 },
    // Main Course
    { categoryId: catBySlug.mains, name: "Wagyu Steak (200g)", description: "Grilled wagyu, mash, jus", price: 325_000, tags: ["main", "beef"], prepMinutes: 18, sortOrder: 0 },
    { categoryId: catBySlug.mains, name: "Grilled Salmon", description: "Norwegian salmon, asparagus, lemon", price: 185_000, tags: ["main", "seafood"], prepMinutes: 15, sortOrder: 1 },
    { categoryId: catBySlug.mains, name: "Spicy Nasi Goreng SOHO", description: "House fried rice, chicken satay, telur", price: 95_000, tags: ["main", "local", "spicy"], prepMinutes: 12, sortOrder: 2 },
    { categoryId: catBySlug.mains, name: "Truffle Mushroom Pasta", description: "Linguine, mushroom, cream, truffle", price: 125_000, tags: ["main", "vegetarian"], prepMinutes: 14, sortOrder: 3 },
  ];

  await db.insert(schema.menuItems).values(menuItems);
  console.log(`✅ Menu items: ${menuItems.length}`);

  // ============================================================
  // DONE
  // ============================================================
  console.log("\n🎉 Seed complete!\n");
  console.log("📊 Summary:");
  console.log(`   - 1 bar: ${bar.name}`);
  console.log(`   - 2 floor areas`);
  console.log(`   - 24 tables`);
  console.log(`   - ${categories.length} menu categories`);
  console.log(`   - ${menuItems.length} menu items`);

  await client.end();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
