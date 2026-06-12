/**
 * Storage adapter contract — generic untuk avatar, story, dll.
 *
 * Implementasi:
 * - local.ts: simpan ke filesystem VPS (MVP)
 * - r2.ts: Cloudflare R2 (S3-compatible) — di-add nanti kalau perlu scale
 *
 * Caller (Server Actions) pakai via barrel `import { storage } from "@/lib/storage"`.
 */

export interface UploadInput {
  /**
   * Buffer file (sudah di-process: resized, compressed).
   * Caller bertanggung jawab validate format + size sebelum panggil upload.
   */
  buffer: Buffer;

  /**
   * Folder logical: "avatars", "stories", "banners", dst.
   * Adapter map ke filesystem path (local) atau S3 key prefix (R2).
   */
  folder: "avatars" | "stories" | "banners";

  /**
   * Unique key untuk file. Untuk avatar: userId. Untuk story: random uuid.
   * Adapter tambah extension sendiri (.webp).
   */
  key: string;

  /**
   * MIME type — disimpan sebagai metadata + dipakai untuk extension.
   * Caller harus convert ke .webp dulu via sharp untuk konsistensi.
   */
  contentType: "image/webp" | "image/jpeg" | "image/png";
}

export interface UploadResult {
  /**
   * Public URL untuk akses file.
   * Local: "/uploads/avatars/<userId>.webp" (nginx serve langsung)
   * R2: "https://cdn.bookingsoho.com/avatars/<userId>.webp"
   */
  publicUrl: string;
}

export interface StorageAdapter {
  upload(input: UploadInput): Promise<UploadResult>;

  /**
   * Delete by publicUrl (yang sama yang di-return dari upload).
   * Idempotent: tidak throw kalau file sudah tidak ada.
   */
  delete(publicUrl: string): Promise<void>;
}
