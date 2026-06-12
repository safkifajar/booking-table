/**
 * Storage barrel — pilih implementation berdasarkan env.
 *
 * STORAGE_DRIVER=local (default) → filesystem
 *
 * Untuk hindari webpack bundle `node:fs` (yang dipakai local.ts), file ini
 * tidak static-import local.ts. Sebagai gantinya, local implementation
 * inlined di sini dengan dynamic Node.js require via eval — webpack tidak
 * static-analyze eval, jadi tidak follow chain ke `node:fs`.
 *
 * File ini sendiri server-only — caller pakai dari Server Actions / API
 * routes (Node.js runtime).
 */

import type { StorageAdapter, UploadInput, UploadResult } from "./types";

const driver = process.env.STORAGE_DRIVER ?? "local";

// ============================================================
// LAZY LOAD nodejs modules via eval (webpack tidak follow)
// ============================================================

interface NodeFs {
  promises: {
    mkdir: (p: string, opts?: { recursive?: boolean }) => Promise<unknown>;
    writeFile: (p: string, data: Buffer) => Promise<void>;
    unlink: (p: string) => Promise<void>;
  };
}

interface NodePath {
  join: (...segments: string[]) => string;
  dirname: (p: string) => string;
  resolve: (...segments: string[]) => string;
}

let cachedFs: NodeFs | null = null;
let cachedPath: NodePath | null = null;

function getNodeFs(): NodeFs {
  if (cachedFs) return cachedFs;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeRequire = eval("require") as NodeRequire;
  cachedFs = nodeRequire("fs") as NodeFs;
  return cachedFs;
}

function getNodePath(): NodePath {
  if (cachedPath) return cachedPath;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeRequire = eval("require") as NodeRequire;
  cachedPath = nodeRequire("path") as NodePath;
  return cachedPath;
}

// ============================================================
// LOCAL FILESYSTEM ADAPTER (inlined)
// ============================================================

const UPLOADS_DIR =
  process.env.UPLOADS_DIR ??
  (process.cwd
    ? `${process.cwd()}/public/uploads`
    : "./public/uploads");

function extFor(contentType: UploadInput["contentType"]): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

const localStorage: StorageAdapter = {
  async upload(input: UploadInput): Promise<UploadResult> {
    const ext = extFor(input.contentType);
    const fs = getNodeFs();
    const path = getNodePath();
    const fullPath = path.join(UPLOADS_DIR, input.folder, `${input.key}.${ext}`);

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, input.buffer);

    return {
      publicUrl: `/uploads/${input.folder}/${input.key}.${ext}`,
    };
  },

  async delete(publicUrl: string): Promise<void> {
    if (!publicUrl.startsWith("/uploads/")) return;
    const fs = getNodeFs();
    const path = getNodePath();

    // Strip query string (cache-bust) sebelum parse path
    const cleanUrl = publicUrl.split("?")[0];
    const relative = cleanUrl.replace(/^\/uploads\//, "");
    const fullPath = path.join(UPLOADS_DIR, relative);

    // Path traversal guard
    const resolved = path.resolve(fullPath);
    const resolvedRoot = path.resolve(UPLOADS_DIR);
    if (!resolved.startsWith(resolvedRoot)) {
      console.warn(`[storage] delete: path traversal blocked: ${publicUrl}`);
      return;
    }

    try {
      await fs.promises.unlink(resolved);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code !== "ENOENT") {
        console.error(`[storage] delete failed: ${publicUrl}`, err);
      }
    }
  },
};

// ============================================================
// EXPORT
// ============================================================

export const storage: StorageAdapter =
  driver === "local"
    ? localStorage
    : (() => {
        throw new Error(`Unknown STORAGE_DRIVER: ${driver} (supported: local)`);
      })();

export type { StorageAdapter, UploadInput, UploadResult } from "./types";
