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
 * Pakai Auth.js bawaan `Email` provider type tapi dengan custom
 * `sendVerificationRequest` yang pakai Resend (bukan Nodemailer SMTP).
 *
 * Token lifetime: 10 menit (lebih singkat = lebih aman dari email leak).
 */

import EmailProvider from "next-auth/providers/nodemailer";
import { sendEmail } from "./email-service";
import { magicLinkEmail } from "./email-template";

export const magicLinkProvider = EmailProvider({
  id: "resend",
  name: "Email Magic Link",
  // Token TTL 10 menit
  maxAge: 10 * 60,

  // server config tidak dipakai karena kita override sendVerificationRequest,
  // tapi Auth.js validate-nya, jadi kasih dummy.
  server: {
    host: "smtp.resend.com",
    port: 587,
    auth: { user: "resend", pass: "dummy" },
  },
  from: process.env.RESEND_FROM ?? "noreply@booking-table.dev",

  /**
   * Override default Nodemailer send dengan Resend SDK.
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
