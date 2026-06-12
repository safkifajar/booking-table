import "server-only";
import { inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { stories } from "@/lib/db/schema/stories";
import { storage } from "@/lib/storage";

/**
 * Hapus semua story yang sudah expire.
 *
 * - Hapus row dari DB (story_views ter-cascade)
 * - Hapus file dari storage (best-effort, parallel)
 *
 * Idempotent: aman dipanggil berkali-kali, kalau no expired return 0.
 * Dipakai oleh:
 * - Cron endpoint /api/cron/expire-stories (production VPS)
 * - In-process scheduler di instrumentation.ts (dev mode)
 */
export async function expireOldStories(): Promise<{
  deleted: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  const now = new Date();

  const expired = await db
    .select({ id: stories.id, imageUrl: stories.imageUrl })
    .from(stories)
    .where(lt(stories.expiresAt, now));

  if (expired.length === 0) {
    return { deleted: 0, durationMs: Date.now() - startTime };
  }

  await Promise.allSettled(expired.map((s) => storage.delete(s.imageUrl)));
  await db.delete(stories).where(
    inArray(
      stories.id,
      expired.map((s) => s.id)
    )
  );

  return { deleted: expired.length, durationMs: Date.now() - startTime };
}
