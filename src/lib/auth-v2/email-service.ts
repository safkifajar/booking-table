/**
 * Email service abstraction.
 *
 * DUA PROVIDER, dipilih otomatis:
 *   1. OneSignal — dipakai kalau ONESIGNAL_APP_ID + ONESIGNAL_REST_API_KEY ada.
 *   2. Resend    — cadangan, dipakai kalau cuma RESEND_API_KEY yang ada.
 *
 * OneSignal didahulukan karena kuota gratisnya 10.000 email/bulan TANPA batas
 * harian, sedangkan Resend gratis dibatasi 100/hari. Batas harian itu jadi
 * penghalang nyata begitu OTP registrasi ikut lewat email.
 *
 * Interface-nya sengaja generic: pemanggil (magic link, undangan staff, reset
 * password) tak tahu provider mana yang dipakai, jadi berpindah provider tak
 * menyentuh mereka.
 *
 * Dry-run mode: kalau tak ada kredensial provider mana pun (development),
 * email di-log ke console saja, tidak benar-benar kirim. Useful untuk:
 * - Development tanpa akun email
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
  const oneSignalAppId = process.env.ONESIGNAL_APP_ID;
  const oneSignalKey = process.env.ONESIGNAL_REST_API_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  // EMAIL_FROM dipakai kedua provider; RESEND_FROM tetap dibaca supaya
  // konfigurasi lama tak perlu diubah saat rilis.
  const from =
    process.env.EMAIL_FROM ??
    process.env.RESEND_FROM ??
    "noreply@booking-table.dev";

  // OneSignal didahulukan (kuota lebih longgar, tanpa batas harian).
  if (oneSignalAppId && oneSignalKey) {
    return sendViaOneSignal(input, {
      appId: oneSignalAppId,
      apiKey: oneSignalKey,
      from,
    });
  }

  // Dry-run mode — log only, jangan kirim.
  if (!apiKey) {
    // Di production ini hampir pasti misconfig: email penting (magic link,
    // staff invite) diam-diam tidak terkirim → user tak bisa login/setup.
    // Warning keras supaya kelihatan di log PM2, tapi JANGAN throw (biar
    // fitur lain tetap jalan).
    if (process.env.NODE_ENV === "production") {
      console.error(
        "⚠️  [email] RESEND_API_KEY belum di-set di PRODUCTION — email TIDAK " +
          "terkirim (dry-run). Set di .env.local lalu restart PM2."
      );
    }
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

/**
 * Kirim lewat OneSignal Create Message API.
 *
 * `include_unsubscribed: true` WAJIB untuk email transaksional (reset
 * password, OTP, undangan staff): tanpa itu tamu yang pernah berhenti
 * berlangganan email promosi ikut tak menerima email yang dibutuhkannya
 * untuk masuk ke akun sendiri.
 *
 * Alamat yang belum dikenal otomatis dibuatkan subscription oleh OneSignal,
 * jadi tak perlu mendaftarkan tamu lebih dulu.
 */
async function sendViaOneSignal(
  input: SendEmailInput,
  cfg: { appId: string; apiKey: string; from: string }
): Promise<SendEmailResult> {
  // `from` boleh berbentuk "Nama <alamat@domain>" — OneSignal minta nama &
  // alamat terpisah, jadi dipecah di sini.
  const match = cfg.from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const fromName = match?.[1] || process.env.EMAIL_FROM_NAME;
  const fromAddress = match?.[2] ?? cfg.from;

  const res = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      app_id: cfg.appId,
      email_to: [input.to],
      email_subject: input.subject,
      email_body: input.html,
      email_from_address: fromAddress,
      ...(fromName ? { email_from_name: fromName } : {}),
      ...(process.env.EMAIL_REPLY_TO
        ? { email_reply_to: process.env.EMAIL_REPLY_TO }
        : {}),
      include_unsubscribed: true,
    }),
  });

  const body = (await res.json().catch(() => null)) as {
    id?: string;
    errors?: unknown;
  } | null;

  if (!res.ok) {
    // Sertakan pesan asli OneSignal — tanpa itu kegagalan kirim cuma terlihat
    // sebagai "gagal" tanpa petunjuk (domain belum terverifikasi, kuota habis,
    // alamat masuk daftar suppression).
    const detail = body?.errors
      ? JSON.stringify(body.errors)
      : `HTTP ${res.status}`;
    throw new Error(`OneSignal error: ${detail}`);
  }

  // OneSignal membalas 200 dengan `errors` terisi utk kegagalan sebagian —
  // mis. alamat ada di daftar suppression. Itu BUKAN sukses.
  if (body?.errors) {
    throw new Error(`OneSignal error: ${JSON.stringify(body.errors)}`);
  }

  return { id: body?.id ?? null, dryRun: false };
}
