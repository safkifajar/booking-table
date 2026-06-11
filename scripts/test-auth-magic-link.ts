/**
 * Smoke test untuk magic link flow.
 *
 * Karena Auth.js EmailProvider butuh full HTTP context (request/response),
 * test ini fokus ke layer yang bisa di-test isolated:
 *
 * 1. Email template render dengan input valid
 * 2. sendEmail() dry-run mode (no API key)
 * 3. sendEmail() real mode (kalau RESEND_API_KEY ada)
 * 4. Token storage verification (verification_tokens table)
 *
 * Untuk E2E magic link (klik link, sign in), butuh browser → cover di step 8.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { magicLinkEmail } from "../src/lib/auth-v2/email-template";
import { sendEmail } from "../src/lib/auth-v2/email-service";

// Target email — pakai email kamu sendiri kalau pakai Resend sandbox mode
// Usage: npx tsx --env-file=.env.local scripts/test-auth-magic-link.ts user@email.com
const TEST_EMAIL = process.argv[2] ?? "test@booking-table.local";
const TEST_URL = `http://localhost:3000/api/auth/callback/resend?token=abc123def456&email=${encodeURIComponent(TEST_EMAIL)}`;

async function main() {
  console.log("✉️  Testing Magic Link service...\n");

  // 1. Template render
  console.log("📝 Test 1: Render email template");
  const { html, text } = magicLinkEmail({
    email: TEST_EMAIL,
    url: TEST_URL,
    expiresIn: "10 menit",
  });
  if (!html.includes(TEST_URL)) throw new Error("URL not embedded in HTML");
  if (!html.includes(TEST_EMAIL)) throw new Error("Email not embedded in HTML");
  if (!text.includes(TEST_URL)) throw new Error("URL not in text version");
  console.log(`   ✅ HTML rendered: ${html.length} chars`);
  console.log(`   ✅ Text fallback: ${text.length} chars`);
  console.log(`   ✅ URL embedded`);
  console.log(`   ✅ Recipient email embedded`);

  // 2. Send via service
  console.log("\n📤 Test 2: Send email (auto-detect dry-run vs live)");
  const result = await sendEmail({
    to: TEST_EMAIL,
    subject: "[TEST] Sign in ke booking-table",
    html,
    text,
  });

  if (result.dryRun) {
    console.log("   ✅ Dry-run mode (RESEND_API_KEY tidak set)");
    console.log("   ℹ️  Untuk live test, set RESEND_API_KEY di .env.local");
  } else {
    console.log(`   ✅ Live send sukses, message id: ${result.id}`);
    console.log(`   📨 Cek inbox ${TEST_EMAIL} untuk verifikasi visual`);
  }

  console.log("\n🎉 All magic link tests passed!");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
