/**
 * Profile auto-create — dipanggil saat user baru dibuat oleh Auth.js.
 *
 * Magic link & OAuth flow: Auth.js create user di `users` table tanpa
 * minta `displayName`. Kita perlu auto-create profile dengan default
 * value supaya `requireProfile()` tidak return null.
 *
 * Default displayName: ambil dari email (part before @) atau "Guest".
 * User bisa update lewat /profile page nanti.
 *
 * Signup credentials sudah create profile dalam transaction
 * (lib/auth-v2/signup.ts), jadi callback ini perlu idempotent:
 * cek dulu apakah profile sudah ada.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema/profiles";

interface BootstrapInput {
  userId: string;
  email?: string | null;
  name?: string | null;
}

/**
 * Generate default display name dari email atau name.
 * - Kalau ada `name` (dari OAuth profile / magic link metadata), pakai itu
 * - Kalau ada email "foo@example.com", pakai "foo"
 * - Fallback "Guest"
 *
 * Limit max 40 char (sesuai schema constraint).
 */
function defaultDisplayName(email?: string | null, name?: string | null): string {
  const candidate = name?.trim() || email?.split("@")[0]?.trim() || "Guest";
  return candidate.slice(0, 40);
}

/**
 * Idempotent: kalau profile sudah ada (ex. dari credentials signup
 * yang sudah create profile dalam transaction), do nothing.
 */
export async function bootstrapProfile(input: BootstrapInput): Promise<void> {
  const existing = await db.query.profiles.findFirst({
    where: eq(profiles.id, input.userId),
    columns: { id: true },
  });
  if (existing) return;

  await db.insert(profiles).values({
    id: input.userId,
    displayName: defaultDisplayName(input.email, input.name),
  });
}
