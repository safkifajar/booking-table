/**
 * Password hashing & verification dengan bcrypt.
 *
 * Pakai bcryptjs (pure JS) bukan bcrypt native, karena:
 * - Vercel serverless: native modules harus di-compile match target,
 *   pure JS works everywhere
 * - Performance gap negligible untuk auth use case (1-2 hash per request)
 *
 * Cost factor 10 = ~100ms hash time di server modern.
 * Trade-off: higher cost = harder brute force, but slower login UX.
 */

import bcrypt from "bcryptjs";

const BCRYPT_COST = 10;

/**
 * Hash plain password → store ke users.password_hash di DB.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 6) {
    throw new Error("Password minimal 6 karakter");
  }
  if (plain.length > 100) {
    throw new Error("Password maksimal 100 karakter");
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Verify plain password against stored hash.
 * Return true kalau cocok, false kalau tidak (atau hash null/empty).
 *
 * Tidak throw error — caller decide bagaimana handle invalid credential.
 */
export async function verifyPassword(
  plain: string,
  hash: string | null
): Promise<boolean> {
  if (!hash) return false;
  if (!plain) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
