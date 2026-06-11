/**
 * Magic link provider — sign in pakai email (no password).
 *
 * Flow:
 * 1. User input email di /auth
 * 2. signIn("resend", { email }) → trigger sendVerificationRequest
 * 3. Auth.js generate random token, store di verification_tokens table
 * 4. Kirim email berisi link `https://app/api/auth/callback/resend?token=...`
 * 5. User klik link → Auth.js verify token → upsert user → sign in
 *
 * Pakai Auth.js built-in `Resend` provider (next-auth/providers/resend).
 * Bukan EmailProvider/nodemailer, karena nodemailer construct SMTP transport
 * di module-init time yang crash worker walaupun sendVerificationRequest
 * di-override.
 *
 * Token lifetime: 10 menit (lebih singkat = lebih aman dari email leak).
 */

import Resend from "next-auth/providers/resend";
import { sendEmail } from "./email-service";
import { magicLinkEmail } from "./email-template";

export const magicLinkProvider = Resend({
  id: "resend",
  name: "Email Magic Link",
  // Token TTL 10 menit (default Resend provider 24 jam — kita override)
  maxAge: 10 * 60,
  // apiKey tetap dibaca dari env (Auth.js convention: AUTH_RESEND_KEY)
  // tapi kita override sendVerificationRequest jadi tidak dipakai.
  apiKey: process.env.RESEND_API_KEY ?? "dry-run",
  from: process.env.RESEND_FROM ?? "noreply@booking-table.dev",

  /**
   * Override default Resend send dengan branded SOHO template.
   * Dipanggil otomatis oleh Auth.js saat user request magic link.
   */
  async sendVerificationRequest({ identifier: email, url }) {
    const { html, text } = magicLinkEmail({
      email,
      url,
      expiresIn: "10 menit",
    });

    const result = await sendEmail({
      to: email,
      subject: "Sign in ke booking-table",
      html,
      text,
    });

    if (result.dryRun) {
      console.log(`   🔗 Magic link URL: ${url}`);
    }
  },
});
