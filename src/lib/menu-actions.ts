"use server";

/**
 * Server Actions untuk Menu CRUD admin.
 *
 * - Categories: CRUD (name, slug, sort_order, is_active)
 * - Items: CRUD (name, price, desc, image, tags, is_available, sort_order)
 * - Image upload pakai pattern banner (sharp resize → webp → storage)
 *
 * Akses: admin/manager (cek via requireAdminForBar).
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { menuCategories, menuItems } from "@/lib/db/schema/menu";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile } from "@/lib/auth-v2/current";

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
    throw new Error("Hanya admin/manager yang bisa kelola menu");
  }
  return { profile, role: staff.role };
}

// ============================================================
// LIST (admin)
// ============================================================

export interface AdminMenuCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
}

export interface AdminMenuItem {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  tags: string[];
  isAvailable: boolean;
  prepMinutes: number | null;
  sortOrder: number;
}

export async function getAdminMenuCategories(
  barId: string
): Promise<AdminMenuCategory[]> {
  await requireAdminForBar(barId);
  const rows = await db
    .select({
      id: menuCategories.id,
      name: menuCategories.name,
      slug: menuCategories.slug,
      sortOrder: menuCategories.sortOrder,
      isActive: menuCategories.isActive,
    })
    .from(menuCategories)
    .where(eq(menuCategories.barId, barId))
    .orderBy(asc(menuCategories.createdAt));

  if (rows.length === 0) return [];

  // Count items per category (aggregation SQL)
  const countRows = await db
    .select({
      categoryId: menuItems.categoryId,
      count: sql<number>`COUNT(${menuItems.id})::int`,
    })
    .from(menuItems)
    .where(
      sql`${menuItems.categoryId} in (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`, `
      )})`
    )
    .groupBy(menuItems.categoryId);
  const countMap = new Map<string, number>();
  for (const r of countRows) {
    countMap.set(r.categoryId, Number(r.count));
  }

  return rows.map((r) => ({
    ...r,
    itemCount: countMap.get(r.id) ?? 0,
  }));
}

export async function getAdminMenuItems(
  barId: string
): Promise<AdminMenuItem[]> {
  await requireAdminForBar(barId);
  const rows = await db
    .select({
      id: menuItems.id,
      categoryId: menuItems.categoryId,
      categoryName: menuCategories.name,
      name: menuItems.name,
      description: menuItems.description,
      price: menuItems.price,
      imageUrl: menuItems.imageUrl,
      tags: menuItems.tags,
      isAvailable: menuItems.isAvailable,
      prepMinutes: menuItems.prepMinutes,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .innerJoin(
      menuCategories,
      eq(menuCategories.id, menuItems.categoryId)
    )
    .where(eq(menuCategories.barId, barId))
    .orderBy(asc(menuCategories.createdAt), asc(menuItems.createdAt));
  return rows;
}

// ============================================================
// CATEGORY CRUD
// ============================================================

const categorySchema = z.object({
  barId: z.string().uuid(),
  name: z.string().min(1).max(60),
  isActive: z.boolean().default(true),
});

/**
 * Generate slug dari nama. Kalau duplikat di bar yang sama, tambah suffix
 * `-2`, `-3`, dst sampai unique. Idempotent: pass `excludeId` saat update
 * supaya tidak conflict dengan slug existing miliknya sendiri.
 */
async function generateUniqueSlug(
  barId: string,
  name: string,
  excludeId: string | null = null
): Promise<string> {
  const baseSlug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) || "kategori"; // fallback kalau name semua non-ascii

  // Ambil semua slug existing di bar (mulai dengan baseSlug) — typical kecil count
  const existing = await db
    .select({ id: menuCategories.id, slug: menuCategories.slug })
    .from(menuCategories)
    .where(eq(menuCategories.barId, barId));

  const takenSlugs = new Set(
    existing
      .filter((r) => r.id !== excludeId)
      .map((r) => r.slug)
  );

  if (!takenSlugs.has(baseSlug)) return baseSlug;
  // Cari suffix terkecil yang available
  let n = 2;
  while (takenSlugs.has(`${baseSlug}-${n}`)) n++;
  return `${baseSlug}-${n}`;
}

export async function createCategory(input: z.infer<typeof categorySchema>) {
  const data = categorySchema.parse(input);
  await requireAdminForBar(data.barId);

  const slug = await generateUniqueSlug(data.barId, data.name);

  try {
    const [created] = await db
      .insert(menuCategories)
      .values({
        barId: data.barId,
        name: data.name.trim(),
        slug,
        isActive: data.isActive,
      })
      .returning({ id: menuCategories.id });
    revalidatePath("/admin/menu");
    return { id: created.id, slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    throw new Error(msg || "Gagal membuat kategori");
  }
}

const updateCategorySchema = categorySchema.extend({
  id: z.string().uuid(),
});

export async function updateCategory(
  input: z.infer<typeof updateCategorySchema>
) {
  const data = updateCategorySchema.parse(input);
  await requireAdminForBar(data.barId);

  const [existing] = await db
    .select({ barId: menuCategories.barId, name: menuCategories.name })
    .from(menuCategories)
    .where(eq(menuCategories.id, data.id));
  if (!existing) throw new Error("Kategori tidak ditemukan");
  if (existing.barId !== data.barId) throw new Error("Akses bar tidak valid");

  // Kalau nama berubah, regenerate slug. Kalau tidak, slug tetap.
  const trimmedName = data.name.trim();
  const slug =
    trimmedName === existing.name
      ? undefined
      : await generateUniqueSlug(data.barId, trimmedName, data.id);

  try {
    await db
      .update(menuCategories)
      .set({
        name: trimmedName,
        ...(slug !== undefined ? { slug } : {}),
        isActive: data.isActive,
      })
      .where(eq(menuCategories.id, data.id));
    revalidatePath("/admin/menu");
    return { slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    throw new Error(msg || "Gagal update kategori");
  }
}

export async function deleteCategory(categoryId: string) {
  const [existing] = await db
    .select({ barId: menuCategories.barId })
    .from(menuCategories)
    .where(eq(menuCategories.id, categoryId));
  if (!existing) return; // sudah hilang

  await requireAdminForBar(existing.barId);

  // Cek apakah ada items — kalau iya, blokir delete (safer)
  const [first] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(eq(menuItems.categoryId, categoryId))
    .limit(1);
  if (first) {
    throw new Error(
      "Kategori masih punya item. Pindahkan atau hapus item dulu."
    );
  }

  await db.delete(menuCategories).where(eq(menuCategories.id, categoryId));
  revalidatePath("/admin/menu");
}

// ============================================================
// ITEM CRUD
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

const itemMetaSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional().or(z.literal("")),
  price: z.number().int().min(0).max(10_000_000),
  tags: z.array(z.string().max(20)).max(10).default([]),
  isAvailable: z.boolean().default(true),
  prepMinutes: z.number().int().min(0).max(120).default(5),
});

async function resolveBarIdForCategory(categoryId: string): Promise<string> {
  const [row] = await db
    .select({ barId: menuCategories.barId })
    .from(menuCategories)
    .where(eq(menuCategories.id, categoryId));
  if (!row) throw new Error("Kategori tidak ditemukan");
  return row.barId;
}

/**
 * Create menu item. FormData supaya bisa terima file image opsional.
 */
export async function createMenuItem(
  formData: FormData
): Promise<{ id: string }> {
  const tagsRaw = formData.get("tags");
  const tags =
    typeof tagsRaw === "string" && tagsRaw.trim()
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const meta = itemMetaSchema.parse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price: Number(formData.get("price") ?? 0),
    tags,
    isAvailable: formData.get("isAvailable") === "true",
    prepMinutes: Number(formData.get("prepMinutes") ?? 5),
  });

  const barId = await resolveBarIdForCategory(meta.categoryId);
  await requireAdminForBar(barId);

  let imageUrl: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      throw new Error(`Gambar terlalu besar (max ${MAX_BYTES / 1024 / 1024}MB)`);
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

    // Menu item 1:1 ratio max 800×800 — fit cover supaya konsisten
    const outputBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(800, 800, { fit: "cover", position: "center" })
      .webp({ quality: 82 })
      .toBuffer();

    // Insert row dulu untuk dapat id (storage key)
    const [created] = await db
      .insert(menuItems)
      .values({
        categoryId: meta.categoryId,
        name: meta.name.trim(),
        description: meta.description?.trim() || null,
        price: meta.price,
        imageUrl: null,
        tags: meta.tags,
        isAvailable: meta.isAvailable,
        prepMinutes: meta.prepMinutes,
      })
      .returning({ id: menuItems.id });

    const { publicUrl } = await storage.upload({
      buffer: outputBuffer,
      folder: "menu",
      key: created.id,
      contentType: "image/webp",
    });
    imageUrl = publicUrl;

    await db
      .update(menuItems)
      .set({ imageUrl })
      .where(eq(menuItems.id, created.id));

    revalidatePath("/admin/menu");
    return { id: created.id };
  }

  // No image
  const [created] = await db
    .insert(menuItems)
    .values({
      categoryId: meta.categoryId,
      name: meta.name.trim(),
      description: meta.description?.trim() || null,
      price: meta.price,
      imageUrl: null,
      tags: meta.tags,
      isAvailable: meta.isAvailable,
      prepMinutes: meta.prepMinutes,
    })
    .returning({ id: menuItems.id });

  revalidatePath("/admin/menu");
  return { id: created.id };
}

/**
 * Update meta + opsional ganti image. Kalau ada file baru, replace.
 */
export async function updateMenuItem(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("ID item tidak valid");

  const tagsRaw = formData.get("tags");
  const tags =
    typeof tagsRaw === "string" && tagsRaw.trim()
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const meta = itemMetaSchema.parse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price: Number(formData.get("price") ?? 0),
    tags,
    isAvailable: formData.get("isAvailable") === "true",
    prepMinutes: Number(formData.get("prepMinutes") ?? 5),
  });

  const [existing] = await db
    .select({
      id: menuItems.id,
      imageUrl: menuItems.imageUrl,
      categoryId: menuItems.categoryId,
    })
    .from(menuItems)
    .where(eq(menuItems.id, id));
  if (!existing) throw new Error("Item tidak ditemukan");

  const barId = await resolveBarIdForCategory(meta.categoryId);
  await requireAdminForBar(barId);

  // Kalau pindah kategori, verify kategori baru juga milik bar yang sama
  if (existing.categoryId !== meta.categoryId) {
    const oldBarId = await resolveBarIdForCategory(existing.categoryId);
    if (oldBarId !== barId) {
      throw new Error("Tidak boleh pindah item ke bar lain");
    }
  }

  let imageUrl = existing.imageUrl;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      throw new Error(`Gambar terlalu besar (max ${MAX_BYTES / 1024 / 1024}MB)`);
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
      .resize(800, 800, { fit: "cover", position: "center" })
      .webp({ quality: 82 })
      .toBuffer();

    // Hapus file lama (best-effort)
    if (existing.imageUrl) {
      await storage.delete(existing.imageUrl);
    }

    const { publicUrl } = await storage.upload({
      buffer: outputBuffer,
      folder: "menu",
      key: id,
      contentType: "image/webp",
    });
    imageUrl = `${publicUrl}?v=${Buffer.from(id).readUInt32BE(0)}`;
  }

  await db
    .update(menuItems)
    .set({
      categoryId: meta.categoryId,
      name: meta.name.trim(),
      description: meta.description?.trim() || null,
      price: meta.price,
      imageUrl,
      tags: meta.tags,
      isAvailable: meta.isAvailable,
      prepMinutes: meta.prepMinutes,
    })
    .where(eq(menuItems.id, id));

  revalidatePath("/admin/menu");
}

export async function deleteMenuItem(itemId: string): Promise<void> {
  const [existing] = await db
    .select({
      id: menuItems.id,
      imageUrl: menuItems.imageUrl,
      categoryId: menuItems.categoryId,
    })
    .from(menuItems)
    .where(eq(menuItems.id, itemId));
  if (!existing) return;

  const barId = await resolveBarIdForCategory(existing.categoryId);
  await requireAdminForBar(barId);

  if (existing.imageUrl) {
    const { storage } = await import("@/lib/storage");
    await storage.delete(existing.imageUrl);
  }
  await db.delete(menuItems).where(eq(menuItems.id, itemId));
  revalidatePath("/admin/menu");
}

/**
 * Toggle availability — operasi cepat tanpa modal (stock habis sementara).
 */
export async function toggleItemAvailability(
  itemId: string,
  isAvailable: boolean
): Promise<void> {
  const [existing] = await db
    .select({ categoryId: menuItems.categoryId })
    .from(menuItems)
    .where(eq(menuItems.id, itemId));
  if (!existing) throw new Error("Item tidak ditemukan");

  const barId = await resolveBarIdForCategory(existing.categoryId);
  await requireAdminForBar(barId);

  await db
    .update(menuItems)
    .set({ isAvailable })
    .where(eq(menuItems.id, itemId));
  revalidatePath("/admin/menu");
}
