/**
 * Credentials provider untuk Auth.js — login dengan email ATAU username + password.
 *
 * Flow:
 * 1. User submit form di /auth dengan identifier (email/username) & password
 * 2. Auth.js panggil `authorize()` di sini
 * 3. Lookup user: kalau identifier mengandung "@" → by email (tabel users);
 *    kalau tidak → by username (tabel profiles) lalu ambil user-nya
 * 4. Verify password dengan bcrypt
 * 5. Return user object (id, email) kalau valid, null kalau tidak
 *
 * Note: Credentials provider TIDAK bisa pakai database session strategy
 * (Auth.js limitation). Kita pakai JWT strategy di src/auth.ts.
 *
 * Signup flow ada di file terpisah (signup.ts) — Credentials provider
 * cuma untuk SIGN IN existing user.
 */

import CredentialsProvider from "next-auth/providers/credentials";
import { CredentialsSignin } from "next-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { profiles } from "@/lib/db/schema/profiles";
import { verifyPassword } from "./password";

/** Akun di-nonaktifkan admin. `code` dibawa Auth.js ke error sign-in. */
class AccountDisabledError extends CredentialsSignin {
  code = "account_disabled";
}

const credentialsSchema = z.object({
  // identifier = email ATAU username. Validasi email/username spesifik
  // dilakukan saat lookup (bukan di schema) — cukup pastikan non-kosong.
  identifier: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

export const credentialsProvider = CredentialsProvider({
  // Nama provider — referenced di signIn("credentials", ...)
  id: "credentials",
  name: "Email & Password",

  // Schema input — hint untuk Auth.js UI bawaan (kita pakai custom form jadi cuma metadata)
  credentials: {
    identifier: { label: "Email or username", type: "text" },
    password: { label: "Password", type: "password" },
  },

  /**
   * Authorize callback — return user object kalau credential valid.
   * Return null kalau invalid → Auth.js throw CredentialsSignin error.
   *
   * SECURITY: jangan kasih beda message untuk "identifier tidak ada" vs
   * "password salah" — biar tidak ada user enumeration.
   */
  async authorize(raw) {
    // Validate input shape
    const parsed = credentialsSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    const { identifier, password } = parsed.data;
    const id = identifier.toLowerCase().trim();

    // Deteksi email SEJATI = pola `x@y.z` (ada domain). Selain itu → username.
    // Username tak perlu "@"; tapi kalau user tetap ketik "@bdui", buang "@"-nya
    // supaya "@bdui" dan "bdui" sama-sama cocok ke username DB (disimpan tanpa @).
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
    const user = isEmail
      ? await db.query.users.findFirst({ where: eq(users.email, id) })
      : await (async () => {
          const uname = id.replace(/^@/, "");
          const profile = await db.query.profiles.findFirst({
            where: eq(profiles.username, uname),
            columns: { id: true },
          });
          if (!profile) return undefined;
          return db.query.users.findFirst({ where: eq(users.id, profile.id) });
        })();

    if (!user) {
      // Constant-time dummy verify untuk hindari timing attack
      await verifyPassword(password, "$2b$10$dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy.D");
      return null;
    }

    // Verify password
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return null;

    // Akun di-nonaktifkan admin → tolak login.
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { isActive: true },
    });
    if (profile && !profile.isActive) {
      throw new AccountDisabledError();
    }

    // Return user object — Auth.js akan inject ke JWT lewat callback
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      image: user.image ?? null,
    };
  },
});
