/**
 * Repro: load full Auth.js stack (auth.ts) & lihat apakah crash di module-init.
 *
 * Kalau script ini exit normal → masalah di Next.js worker spawn / bundler.
 * Kalau crash → masalah di code kita.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

console.log("1️⃣  Loading @/auth...");
import("../src/auth")
  .then((mod) => {
    console.log("2️⃣  ✅ auth module loaded");
    console.log("   handlers:", typeof mod.handlers.GET, typeof mod.handlers.POST);
    console.log("   auth():", typeof mod.auth);
    console.log("   signIn():", typeof mod.signIn);
    console.log("   signOut():", typeof mod.signOut);
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ FAILED to load auth module:");
    console.error(err);
    process.exit(1);
  });
