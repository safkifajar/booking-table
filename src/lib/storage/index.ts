/**
 * Storage barrel — pilih implementation berdasarkan env.
 *
 * STORAGE_DRIVER=local (default) → filesystem
 * STORAGE_DRIVER=r2 → Cloudflare R2 (future)
 *
 * Caller cuma import { storage } — implementation di-swap via env tanpa
 * sentuh kode caller.
 */

import { localStorage } from "./local";
import type { StorageAdapter } from "./types";

const driver = process.env.STORAGE_DRIVER ?? "local";

export const storage: StorageAdapter =
  driver === "local"
    ? localStorage
    : (() => {
        throw new Error(`Unknown STORAGE_DRIVER: ${driver} (supported: local)`);
      })();

export type { StorageAdapter, UploadInput, UploadResult } from "./types";
