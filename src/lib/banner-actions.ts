"use server";

/**
 * Server Actions untuk Bar Banner promo.
 *
 * - getActiveBanners: dipakai landing page (public)
 * - getAllBannersForAdmin / createBanner / updateBanner / deleteBanner:
 *   admin-only (cek staff role di action)
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { barBanners } from "@/lib/db/schema/banners";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile } from "@/lib/auth-v2/current";

// ============================================================
// PUBLIC — get active banners
// ============================================================

export interface PublicBanner {
  id: string;
  imageUrl: string;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
}

export async function getActiveBanners(barId: string): Promise<PublicBanner[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: barBanners.id,
      imageUrl: barBanners.imageUrl,
      title: barBanners.title,
      subtitle: barBanners.subtitle,
      sortOrder: barBanners.sortOrder,
    })
    .from(barBanners)
    .where(
      and(
        eq(barBanners.barId, barId),
        eq(barBanners.isActive, true),
        // startsAt NULL atau <= now
        or(isNull(barBanners.startsAt), lte(barBanners.startsAt, now)),
        // endsAt NULL atau >= now
        or(isNull(barBanners.endsAt), gte(barBanners.endsAt, now))
      )
    )
    .orderBy(asc(barBanners.sortOrder), asc(barBanners.createdAt));
  return rows;
}

// ============================================================
// ADMIN GUARD
// ============================================================

async function requireAdminForBar(barId: string) {
  const profile = await requireProfile();
  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profile.id),
        eq(staffRoles.barId, barId),
        eq(staffRoles.isActive, true)
      )
    );
  if (!staff) throw new Error("Akses admin diperlukan");
  if (staff.role !== "admin" && staff.role !== "manager") {
    throw new Error("Hanya admin/manager yang bisa kelola banner");
  }
  return { profile, role: staff.role };
}

// ============================================================
// ADMIN LIST
// ============================================================

export interface AdminBanner {
  id: string;
  imageUrl: string;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
}

export async function getAllBannersForAdmin(
  barId: string
): Promise<AdminBanner[]> {
  await requireAdminForBar(barId);

  const rows = await db
    .select({
      id: barBanners.id,
      imageUrl: barBanners.imageUrl,
      title: barBanners.title,
      subtitle: barBanners.subtitle,
      sortOrder: barBanners.sortOrder,
      isActive: barBanners.isActive,
      startsAt: barBanners.startsAt,
      endsAt: barBanners.endsAt,
      createdAt: barBanners.createdAt,
    })
    .from(barBanners)
    .where(eq(barBanners.barId, barId))
    .orderBy(asc(barBanners.sortOrder), asc(barBanners.createdAt));
  return rows;
}

// ============================================================
// CREATE
// ============================================================

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
const MAX_BYTES = 10 * 1024 * 1024;

function isHeicFile(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

const bannerMetaSchema = z.object({
  barId: z.string().uuid(),
  title: z.string().max(80).optional().or(z.literal("")),
  subtitle: z.string().max(200).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  startsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional()
    .or(z.literal("")),
  endsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional()
    .or(z.literal("")),
});

export type CreateBannerInput = z.infer<typeof bannerMetaSchema>;

export async function createBanner(
  formData: FormData
): Promise<{ id: string }> {
  // Parse meta dari formData
  const meta = bannerMetaSchema.parse({
    barId: formData.get("barId"),
    title: formData.get("title") || undefined,
    subtitle: formData.get("subtitle") || undefined,
    sortOrder: Number(formData.get("sortOrder") ?? 0),
    isActive: formData.get("isActive") === "true",
    startsAt: formData.get("startsAt") || undefined,
    endsAt: formData.get("endsAt") || undefined,
  });

  await requireAdminForBar(meta.barId);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File tidak valid");
  if (file.size === 0) throw new Error("File kosong");
  if (file.size > MAX_BYTES) {
    throw new Error(`File terlalu besar (max ${MAX_BYTES / 1024 / 1024}MB)`);
  }

  const heic = isHeicFile(file);
  const validMime = ACCEPTED_TYPES.includes(
    file.type as (typeof ACCEPTED_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("Format file harus JPG, PNG, WebP, atau HEIC");
  }

  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  // Banner 16:9 ratio max 1600×900, fit cover supaya konsisten
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(1600, 900, { fit: "cover", position: "center" })
    .webp({ quality: 85 })
    .toBuffer();

  // Insert row dulu untuk dapat id (jadi storage key)
  const [created] = await db
    .insert(barBanners)
    .values({
      barId: meta.barId,
      imageUrl: "PENDING",
      title: meta.title?.trim() || null,
      subtitle: meta.subtitle?.trim() || null,
      sortOrder: meta.sortOrder,
      isActive: meta.isActive,
      startsAt: meta.startsAt ? new Date(meta.startsAt) : null,
      endsAt: meta.endsAt ? new Date(meta.endsAt) : null,
    })
    .returning({ id: barBanners.id });

  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "banners",
    key: created.id,
    contentType: "image/webp",
  });

  await db
    .update(barBanners)
    .set({ imageUrl: publicUrl })
    .where(eq(barBanners.id, created.id));

  revalidatePath("/", "layout");
  revalidatePath("/admin/banners");
  return { id: created.id };
}

// ============================================================
// UPDATE
// ============================================================

const updateMetaSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(80).optional().or(z.literal("")),
  subtitle: z.string().max(200).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
  startsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional()
    .or(z.literal("")),
  endsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional()
    .or(z.literal("")),
});

export async function updateBanner(input: z.infer<typeof updateMetaSchema>) {
  const data = updateMetaSchema.parse(input);

  // Cek banner exists + ambil barId untuk auth
  const [existing] = await db
    .select({ barId: barBanners.barId })
    .from(barBanners)
    .where(eq(barBanners.id, data.id));
  if (!existing) throw new Error("Banner tidak ditemukan");

  await requireAdminForBar(existing.barId);

  await db
    .update(barBanners)
    .set({
      title: data.title?.trim() || null,
      subtitle: data.subtitle?.trim() || null,
      sortOrder: data.sortOrder,
      isActive: data.isActive,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
    })
    .where(eq(barBanners.id, data.id));

  revalidatePath("/", "layout");
  revalidatePath("/admin/banners");
}

/**
 * Ganti foto banner (sekalian update meta yang lain — lebih simple
 * daripada 2 endpoint). Kalau file === null, skip upload, cuma meta.
 */
export async function replaceBannerImage(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("ID banner tidak valid");

  const [existing] = await db
    .select({ barId: barBanners.barId, imageUrl: barBanners.imageUrl })
    .from(barBanners)
    .where(eq(barBanners.id, id));
  if (!existing) throw new Error("Banner tidak ditemukan");

  await requireAdminForBar(existing.barId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("File tidak valid");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File terlalu besar (max ${MAX_BYTES / 1024 / 1024}MB)`);
  }

  const heic = isHeicFile(file);
  const validMime = ACCEPTED_TYPES.includes(
    file.type as (typeof ACCEPTED_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("Format file harus JPG, PNG, WebP, atau HEIC");
  }

  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(1600, 900, { fit: "cover", position: "center" })
    .webp({ quality: 85 })
    .toBuffer();

  // Hapus file lama (best-effort)
  await storage.delete(existing.imageUrl);

  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "banners",
    key: id,
    contentType: "image/webp",
  });

  // Cache-bust dengan timestamp
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;
  await db
    .update(barBanners)
    .set({ imageUrl: versionedUrl })
    .where(eq(barBanners.id, id));

  revalidatePath("/", "layout");
  revalidatePath("/admin/banners");
}

// ============================================================
// DELETE
// ============================================================

export async function deleteBanner(bannerId: string): Promise<void> {
  const [existing] = await db
    .select({ barId: barBanners.barId, imageUrl: barBanners.imageUrl })
    .from(barBanners)
    .where(eq(barBanners.id, bannerId));
  if (!existing) return; // sudah hilang, idempotent

  await requireAdminForBar(existing.barId);

  const { storage } = await import("@/lib/storage");
  await storage.delete(existing.imageUrl);
  await db.delete(barBanners).where(eq(barBanners.id, bannerId));

  revalidatePath("/", "layout");
  revalidatePath("/admin/banners");
}
