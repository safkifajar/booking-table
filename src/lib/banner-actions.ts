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
  category: "promo" | "event";
  title: string | null;
  subtitle: string | null;
  content: string | null;
  sortOrder: number;
  /** Periode tayang (ISO). null = tanpa batas. */
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * Satu banner utk halaman detail promo (/promo/[id]).
 * Hanya mengembalikan banner yang SEDANG tayang (aktif + dalam jadwal) —
 * promo yang sudah lewat/nonaktif tak bisa diakses lewat URL langsung.
 * NULL = tak ada / tak tayang → caller notFound().
 */
export async function getPublicBannerById(
  id: string
): Promise<PublicBanner | null> {
  const now = new Date();
  const [row] = await db
    .select({
      id: barBanners.id,
      imageUrl: barBanners.imageUrl,
      category: barBanners.category,
      title: barBanners.title,
      subtitle: barBanners.subtitle,
      content: barBanners.content,
      sortOrder: barBanners.sortOrder,
      startsAt: barBanners.startsAt,
      endsAt: barBanners.endsAt,
    })
    .from(barBanners)
    .where(
      and(
        eq(barBanners.id, id),
        eq(barBanners.isActive, true),
        or(isNull(barBanners.startsAt), lte(barBanners.startsAt, now)),
        or(isNull(barBanners.endsAt), gte(barBanners.endsAt, now))
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
  };
}

export async function getActiveBanners(barId: string): Promise<PublicBanner[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: barBanners.id,
      imageUrl: barBanners.imageUrl,
      category: barBanners.category,
      title: barBanners.title,
      subtitle: barBanners.subtitle,
      content: barBanners.content,
      sortOrder: barBanners.sortOrder,
      startsAt: barBanners.startsAt,
      endsAt: barBanners.endsAt,
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
  return rows.map((r) => ({
    ...r,
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
  }));
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
  if (!staff) throw new Error("Admin access required");
  if (staff.role !== "admin" && staff.role !== "manager") {
    throw new Error("Only admin/manager can manage banners");
  }
  return { profile, role: staff.role };
}

// ============================================================
// ADMIN LIST
// ============================================================

export interface AdminBanner {
  id: string;
  imageUrl: string;
  category: "promo" | "event";
  title: string | null;
  subtitle: string | null;
  content: string | null;
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
      category: barBanners.category,
      title: barBanners.title,
      subtitle: barBanners.subtitle,
      content: barBanners.content,
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
  category: z.enum(["promo", "event"]).default("promo"),
  title: z.string().max(80).optional().or(z.literal("")),
  subtitle: z.string().max(200).optional().or(z.literal("")),
  content: z.string().max(5000).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  startsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .optional()
    .or(z.literal("")),
  endsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
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
    category: formData.get("category") || undefined,
    title: formData.get("title") || undefined,
    subtitle: formData.get("subtitle") || undefined,
    content: formData.get("content") || undefined,
    sortOrder: Number(formData.get("sortOrder") ?? 0),
    isActive: formData.get("isActive") === "true",
    startsAt: formData.get("startsAt") || undefined,
    endsAt: formData.get("endsAt") || undefined,
  });

  await requireAdminForBar(meta.barId);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Invalid file");
  if (file.size === 0) throw new Error("File is empty");
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large (max ${MAX_BYTES / 1024 / 1024}MB)`);
  }

  const heic = isHeicFile(file);
  const validMime = ACCEPTED_TYPES.includes(
    file.type as (typeof ACCEPTED_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("File must be JPG, PNG, WebP, or HEIC");
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
      category: meta.category,
      title: meta.title?.trim() || null,
      subtitle: meta.subtitle?.trim() || null,
      content: meta.content?.trim() || null,
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
  category: z.enum(["promo", "event"]).default("promo"),
  title: z.string().max(80).optional().or(z.literal("")),
  subtitle: z.string().max(200).optional().or(z.literal("")),
  content: z.string().max(5000).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
  startsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .optional()
    .or(z.literal("")),
  endsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
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
  if (!existing) throw new Error("Banner not found");

  await requireAdminForBar(existing.barId);

  await db
    .update(barBanners)
    .set({
      category: data.category,
      title: data.title?.trim() || null,
      subtitle: data.subtitle?.trim() || null,
      content: data.content?.trim() || null,
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
  if (typeof id !== "string") throw new Error("Invalid banner ID");

  const [existing] = await db
    .select({ barId: barBanners.barId, imageUrl: barBanners.imageUrl })
    .from(barBanners)
    .where(eq(barBanners.id, id));
  if (!existing) throw new Error("Banner not found");

  await requireAdminForBar(existing.barId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Invalid file");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large (max ${MAX_BYTES / 1024 / 1024}MB)`);
  }

  const heic = isHeicFile(file);
  const validMime = ACCEPTED_TYPES.includes(
    file.type as (typeof ACCEPTED_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("File must be JPG, PNG, WebP, or HEIC");
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
