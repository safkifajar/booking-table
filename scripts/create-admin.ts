/**
 * Buat / promosikan akun ADMIN (super admin) — dipakai saat environment baru
 * (production/staging) belum punya siapa pun yang bisa masuk /admin.
 *
 * Jalankan DI VPS dari folder app (yang punya .env.local):
 *   npx tsx scripts/create-admin.ts <email> <password> ["Nama Tampilan"]
 *
 * Contoh:
 *   npx tsx scripts/create-admin.ts owner@ratssocial.com 'RahasiaKuat123!' "Owner"
 *
 * Sifat: IDEMPOTEN & aman diulang —
 * - Email belum ada        → buat users + profiles + staff_roles(admin).
 * - Email sudah ada        → password DI-RESET ke argumen, role dipastikan admin.
 * - Sudah admin            → hanya password yang di-update (tak menggandakan role).
 *
 * Catatan: password di-hash bcrypt lewat helper app yang sama dengan login,
 * jadi tak ada risiko beda algoritma.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq } from "drizzle-orm";

// CATATAN: modul di bawah di-import DINAMIS di dalam main(), bukan di atas.
// src/lib/db/client.ts membaca process.env.DATABASE_URL saat module-load dan
// throw kalau kosong — sedangkan import statis dievaluasi SEBELUM config()
// di atas sempat mengisi env. Import dinamis memastikan .env.local sudah
// termuat lebih dulu.

async function main() {
  const { db } = await import("@/lib/db/client");
  const { users } = await import("@/lib/db/schema/auth");
  const { profiles } = await import("@/lib/db/schema/profiles");
  const { staffRoles } = await import("@/lib/db/schema/extras");
  const { bars } = await import("@/lib/db/schema/venue");
  const { hashPassword } = await import("@/lib/auth-v2/password");

  const [emailRaw, password, displayNameRaw] = process.argv.slice(2);

  if (!emailRaw || !password) {
    console.error(
      "Usage: npx tsx scripts/create-admin.ts <email> <password> [\"Display Name\"]"
    );
    process.exit(1);
  }
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`ERROR: email tidak valid: ${email}`);
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("ERROR: password minimal 8 karakter.");
    process.exit(1);
  }
  const displayName = (displayNameRaw ?? email.split("@")[0]).trim();

  // Bar target: ambil bar pertama (app ini single-bar per environment).
  const [bar] = await db
    .select({ id: bars.id, name: bars.name })
    .from(bars)
    .limit(1);
  if (!bar) {
    console.error(
      "ERROR: belum ada baris di tabel 'bars'. Seed bar dulu sebelum membuat admin."
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  // 1. User — buat kalau belum ada, kalau ada reset password-nya.
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  let created = false;
  if (existingUser) {
    userId = existingUser.id;
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } else {
    const [row] = await db
      .insert(users)
      .values({
        email,
        name: displayName,
        passwordHash,
        // Dianggap terverifikasi: dibuat manual oleh operator, bukan self-signup.
        emailVerified: new Date(),
      })
      .returning({ id: users.id });
    userId = row.id;
    created = true;
  }

  // 2. Profile — id = users.id (one-to-one). Staff tak perlu onboarding.
  const [existingProfile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!existingProfile) {
    await db.insert(profiles).values({
      id: userId,
      displayName,
      onboarded: true,
      isActive: true,
    });
  } else {
    // Pastikan tak terkunci / tak dipaksa onboarding.
    await db
      .update(profiles)
      .set({ onboarded: true, isActive: true })
      .where(eq(profiles.id, userId));
  }

  // 3. Staff role admin — unique(bar, profile, role) → aman diulang.
  const [existingRole] = await db
    .select({ id: staffRoles.id, isActive: staffRoles.isActive })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.barId, bar.id),
        eq(staffRoles.profileId, userId),
        eq(staffRoles.role, "admin")
      )
    )
    .limit(1);

  if (existingRole) {
    if (!existingRole.isActive) {
      await db
        .update(staffRoles)
        .set({ isActive: true })
        .where(eq(staffRoles.id, existingRole.id));
    }
  } else {
    await db.insert(staffRoles).values({
      barId: bar.id,
      profileId: userId,
      role: "admin",
      isActive: true,
    });
  }

  console.log("");
  console.log("✓ Admin siap dipakai");
  console.log(`  Email   : ${email}`);
  console.log(`  Nama    : ${displayName}`);
  console.log(`  Bar     : ${bar.name}`);
  console.log(`  Status  : ${created ? "user BARU dibuat" : "user sudah ada — password di-reset"}`);
  console.log("");
  // CATATAN: pintu masuk admin adalah /login (di-rewrite ke /admin-login),
  // BUKAN /auth — /auth itu halaman auth CUSTOMER.
  console.log("  Login di: https://admin.<domain-kamu>/login");
  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error("GAGAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
