import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageAdapter, UploadInput, UploadResult } from "./types";

/**
 * Local filesystem storage — MVP untuk single-VPS deployment.
 *
 * File disimpan di `<UPLOADS_DIR>/<folder>/<key>.<ext>`.
 * Public URL: `/uploads/<folder>/<key>.<ext>` — nginx serve langsung
 * (lihat docs/DEPLOYMENT.md untuk config).
 *
 * UPLOADS_DIR default: `<project_root>/public/uploads` (Next.js auto-serve
 * di dev). Production: override via UPLOADS_DIR env ke `/var/lib/booking-table/uploads`
 * supaya tidak ke-bundle saat `next build`.
 *
 * Cleanup old extension: kalau key sama tapi ext beda (user ganti foto dari
 * jpg ke webp), perlu hapus file lama. Caller handle dengan delete() dulu
 * sebelum upload baru — atau pakai extension konstan ".webp" (saran kami
 * untuk avatars, sudah resize via sharp).
 */

const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "public", "uploads");

function extFor(contentType: UploadInput["contentType"]): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

function localPathFor(folder: string, key: string, ext: string): string {
  return path.join(UPLOADS_DIR, folder, `${key}.${ext}`);
}

function publicUrlFor(folder: string, key: string, ext: string): string {
  // Forward slashes for URL (windows path uses backslash)
  return `/uploads/${folder}/${key}.${ext}`;
}

export const localStorage: StorageAdapter = {
  async upload(input: UploadInput): Promise<UploadResult> {
    const ext = extFor(input.contentType);
    const fullPath = localPathFor(input.folder, input.key, ext);

    // Pastikan folder ada
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Tulis file (overwrite kalau sudah ada — untuk replace avatar)
    await fs.writeFile(fullPath, input.buffer);

    return {
      publicUrl: publicUrlFor(input.folder, input.key, ext),
    };
  },

  async delete(publicUrl: string): Promise<void> {
    // Parse publicUrl → local path. Format: /uploads/<folder>/<file>
    if (!publicUrl.startsWith("/uploads/")) {
      // Bukan file lokal kita — skip (mungkin external URL lama)
      return;
    }
    const relative = publicUrl.replace(/^\/uploads\//, "");
    const fullPath = path.join(UPLOADS_DIR, relative);

    // Pastikan masih di dalam UPLOADS_DIR (anti path traversal)
    const resolved = path.resolve(fullPath);
    const resolvedRoot = path.resolve(UPLOADS_DIR);
    if (!resolved.startsWith(resolvedRoot)) {
      console.warn(`[storage] delete: path traversal blocked: ${publicUrl}`);
      return;
    }

    try {
      await fs.unlink(resolved);
    } catch (err) {
      // ENOENT = file tidak ada → OK (idempotent)
      if (err instanceof Error && "code" in err && err.code !== "ENOENT") {
        console.error(`[storage] delete failed: ${publicUrl}`, err);
      }
    }
  },
};
