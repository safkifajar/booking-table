/**
 * Email service abstraction.
 *
 * Sekarang pakai Resend, tapi interface generic supaya bisa swap
 * provider lain (Postmark, SES, SendGrid, SMTP biasa) cuma ganti impl.
 *
 * Dry-run mode: kalau RESEND_API_KEY tidak ada (development),
 * email di-log ke console saja, tidak benar-benar kirim. Useful untuk:
 * - Development tanpa Resend account
 * - Testing di CI
 * - Demo untuk client tanpa setup email
 */

import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  id: string | null;
  dryRun: boolean;
}

/**
 * Send email. Throws kalau gagal.
 * Return id (provider message id) + flag dryRun.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "noreply@booking-table.dev";

  // Dry-run mode — log only, jangan kirim
  if (!apiKey) {
    console.log("\n📧 [DRY-RUN] Email would be sent:");
    console.log(`   To: ${input.to}`);
    console.log(`   From: ${from}`);
    console.log(`   Subject: ${input.subject}`);
    console.log(`   HTML length: ${input.html.length} chars`);
    if (input.text) console.log(`   Text preview: ${input.text.slice(0, 100)}...`);
    console.log("   ℹ️  Set RESEND_API_KEY di .env.local untuk kirim beneran\n");
    return { id: null, dryRun: true };
  }

  // Real send via Resend
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  return { id: data?.id ?? null, dryRun: false };
}
