/**
 * Smoke test: just import magic-link provider & log.
 * Kalau error di sini → masalah di module-init.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { magicLinkProvider } from "../src/lib/auth-v2/magic-link";

console.log("✅ Magic link provider loaded");
console.log("   id:", magicLinkProvider.id);
console.log("   type:", magicLinkProvider.type);
console.log("   maxAge:", magicLinkProvider.maxAge);
console.log("   from:", magicLinkProvider.from);
process.exit(0);
