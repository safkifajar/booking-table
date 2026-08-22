"use server";

/**
 * Reset password lewat email.
 *
 * Alur:
 * 1. Tamu isi email di /auth/forgot → requestPasswordReset()
 * 2. Token acak disimpan di verificationToken, dikirim sebagai tautan
 * 3. Tamu klik tautan → /auth/reset?token=... → resetPassword()
 * 4. Token dihapus, password diganti
 *
 * KEAMANAN — dua hal yang sengaja dipilih:
 *
 * a) requestPasswordReset SELALU menjawab sukses, bahkan untuk email yang tak
 *    terdaftar. Kalau membedakan jawabannya, halaman ini jadi alat untuk
 *    menebak siapa saja yang punya akun di SOHO.
 *
 * b) Token disimpan sebagai HASH, bukan apa adanya. Kalau isi database bocor,
 *    token mentah bisa langsung dipakai mengambil alih akun.
 */

import { createHash, randomBytes } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, verificationTokens } from "@/lib/db/schema/auth";
import { staffRoles } from "@/lib/db/schema/extras";
import { hashPassword } from "./password";
import { sendEmail } from "./email-service";
import { passwordResetEmail } from "./email-template";

/** Berapa lama tautan reset berlaku. */
const TOKEN_TTL_MINUTES = 30;

/**
 * Siapa yang meminta: staff (panel admin) atau tamu (aplikasi customer).
 * Menentukan domain tautan & halaman tempat password disetel.
 */
export type ResetAudience = "customer" | "admin";

/**
 * Penanda identifier supaya token reset tak tertukar dengan token magic-link,
 * yang tinggal di tabel yang sama dan memakai email sebagai identifier.
 */
const RESET_PREFIX = "pwreset:";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * URL dasar untuk tautan reset.
 *
 * `admin` = domain panel staff, selain itu domain aplikasi tamu. Salah
 * domain berarti staff dilempar ke aplikasi tamu (dan sebaliknya) — di
 * production keduanya subdomain berbeda dengan sesi login terpisah.
 */
function baseUrlFor(audience: ResetAudience): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  try {
    const url = new URL(base);
    const bare = url.hostname.replace(/^(admin|link)\./, "");
    url.hostname = audience === "admin" ? `admin.${bare}` : bare;
    url.pathname = "/";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:3000";
  }
}

/**
 * Minta tautan reset password.
 *
 * Selalu `{ ok: true }` — lihat catatan keamanan di atas.
 */
export async function requestPasswordReset(
  emailRaw: string,
  audience: ResetAudience = "customer"
): Promise<{ ok: true }> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: true };

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Email tak terdaftar → berhenti diam-diam, jawaban tetap sama.
  if (!user?.email) return { ok: true };

  // Halaman admin hanya melayani yang PUNYA peran staff aktif. Tanpa ini,
  // siapa pun bisa memakai halaman lupa-password admin untuk mengirimi
  // dirinya tautan berdomain admin — terlihat resmi & memudahkan penipuan.
  if (audience === "admin") {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, user.id), eq(staffRoles.isActive, true))
      )
      .limit(1);
    if (!staff) return { ok: true };
  }

  const identifier = `${RESET_PREFIX}${email}`;

  // Buang token lama milik email ini: tautan yang dikirim sebelumnya harus
  // mati begitu tamu meminta yang baru.
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));

  const rawToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);

  await db.insert(verificationTokens).values({
    identifier,
    token: hashToken(rawToken),
    expires,
  });

  const path = audience === "admin" ? "/reset" : "/auth/reset";
  const link = `${baseUrlFor(audience)}${path}?token=${rawToken}&email=${encodeURIComponent(email)}`;
  const tpl = passwordResetEmail(link, TOKEN_TTL_MINUTES);

  try {
    await sendEmail({
      to: email,
      subject: tpl.subject,
      kind: "password_reset",
      html: tpl.html,
      text: tpl.text,
    });
  } catch (err) {
    // Kegagalan kirim TIDAK dibocorkan ke tamu (jawabannya harus seragam),
    // tapi wajib terlihat di log — tanpa ini tamu menunggu email yang tak
    // pernah datang & kita tak tahu penyebabnya.
    console.error("[reset-password] gagal mengirim email:", err);
  }

  return { ok: true };
}

/** Cek token masih sah — dipakai halaman reset sebelum menampilkan form. */
export async function verifyResetToken(
  token: string,
  emailRaw: string
): Promise<{ ok: boolean; error?: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!token || !email) return { ok: false, error: "Invalid reset link" };

  const [row] = await db
    .select({ expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, `${RESET_PREFIX}${email}`),
        eq(verificationTokens.token, hashToken(token))
      )
    )
    .limit(1);

  if (!row) return { ok: false, error: "This reset link is no longer valid" };
  if (row.expires.getTime() < Date.now()) {
    return { ok: false, error: "This reset link has expired" };
  }
  return { ok: true };
}

/** Ganti password memakai token yang sah. */
export async function resetPassword(
  token: string,
  emailRaw: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  const email = emailRaw.trim().toLowerCase();

  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }

  const valid = await verifyResetToken(token, email);
  if (!valid.ok) return valid;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) return { ok: false, error: "This reset link is no longer valid" };

  const passwordHash = await hashPassword(newPassword);

  // Ganti password & buang token dalam SATU transaksi: token yang tersisa
  // setelah password berganti masih bisa dipakai sekali lagi.
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, user.id));
    await tx
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, `${RESET_PREFIX}${email}`));
  });

  return { ok: true };
}

/**
 * Bersihkan token reset yang sudah lewat masa berlaku.
 *
 * Token kedaluwarsa tak bisa dipakai (dicek saat verifikasi), tapi tak ada
 * gunanya menumpuk di tabel.
 */
export async function purgeExpiredResetTokens(): Promise<number> {
  const deleted = await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expires, new Date()))
    .returning({ token: verificationTokens.token });
  return deleted.length;
}
