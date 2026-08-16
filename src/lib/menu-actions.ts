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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { menuCategories, menuItems } from "@/lib/db/schema/menu";
import { orderItems } from "@/lib/db/schema/orders";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile } from "@/lib/auth-v2/current";
import { logActivity } from "@/lib/activity-log";
import { formatIDR } from "@/lib/utils";

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
    throw new Error("Only admin/manager can manage the menu");
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
  /** null = kategori utama, terisi = sub-kategori di bawah parent tsb. */
  parent_id: string | null;
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
      parent_id: menuCategories.parentId,
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
  // Item hanya menempel di sub-kategori. countMap = jumlah item LANGSUNG per
  // kategori (untuk sub = jumlah item-nya; untuk utama = biasanya 0).
  const countMap = new Map<string, number>();
  for (const r of countRows) {
    countMap.set(r.categoryId, Number(r.count));
  }

  // Total per kategori = item langsung + total item dari sub-kategorinya.
  // Sehingga kategori UTAMA menampilkan gabungan seluruh sub-nya.
  const totalMap = new Map<string, number>();
  for (const r of rows) totalMap.set(r.id, countMap.get(r.id) ?? 0);
  for (const r of rows) {
    if (r.parent_id != null) {
      totalMap.set(
        r.parent_id,
        (totalMap.get(r.parent_id) ?? 0) + (countMap.get(r.id) ?? 0)
      );
    }
  }

  return rows.map((r) => ({
    ...r,
    itemCount: totalMap.get(r.id) ?? 0,
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
  /** Kategori induk (sub-kategori). null/undefined = kategori utama. */
  parentId: z.string().uuid().nullable().optional(),
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

export async function createCategory(
  input: z.infer<typeof categorySchema>
): Promise<{ ok: boolean; error?: string; id?: string; slug?: string }> {
  const data = categorySchema.parse(input);
  await requireAdminForBar(data.barId);

  // Validasi parent: harus kategori utama (parent_id NULL) di bar yg sama —
  // cegah nesting > 2 tingkat.
  if (data.parentId) {
    const [parent] = await db
      .select({ barId: menuCategories.barId, parentId: menuCategories.parentId })
      .from(menuCategories)
      .where(eq(menuCategories.id, data.parentId));
    if (!parent || parent.barId !== data.barId)
      return { ok: false, error: "Invalid parent category" };
    if (parent.parentId != null)
      return {
        ok: false,
        error: "Sub-category cannot be nested under another sub-category",
      };
  }

  const slug = await generateUniqueSlug(data.barId, data.name);

  try {
    const [created] = await db
      .insert(menuCategories)
      .values({
        barId: data.barId,
        name: data.name.trim(),
        slug,
        parentId: data.parentId ?? null,
        isActive: data.isActive,
      })
      .returning({ id: menuCategories.id });
    revalidatePath("/admin/menu");
    return { ok: true, id: created.id, slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return { ok: false, error: msg || "Failed to create category" };
  }
}

const updateCategorySchema = categorySchema.extend({
  id: z.string().uuid(),
});

export async function updateCategory(
  input: z.infer<typeof updateCategorySchema>
): Promise<{ ok: boolean; error?: string; slug?: string }> {
  const data = updateCategorySchema.parse(input);
  await requireAdminForBar(data.barId);

  const [existing] = await db
    .select({ barId: menuCategories.barId, name: menuCategories.name })
    .from(menuCategories)
    .where(eq(menuCategories.id, data.id));
  if (!existing) throw new Error("Category not found");
  if (existing.barId !== data.barId) throw new Error("Invalid bar access");

  // Validasi parent (kalau dikirim): utama, bar sama, bukan diri sendiri.
  if (data.parentId) {
    if (data.parentId === data.id)
      return { ok: false, error: "Category cannot be its own parent" };
    const [parent] = await db
      .select({ barId: menuCategories.barId, parentId: menuCategories.parentId })
      .from(menuCategories)
      .where(eq(menuCategories.id, data.parentId));
    if (!parent || parent.barId !== data.barId)
      return { ok: false, error: "Invalid parent category" };
    if (parent.parentId != null)
      return {
        ok: false,
        error: "Sub-category cannot be nested under another sub-category",
      };
  }

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
        // parentId dikirim → set (null = jadikan utama). undefined → biarkan.
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        isActive: data.isActive,
      })
      .where(eq(menuCategories.id, data.id));
    revalidatePath("/admin/menu");
    return { ok: true, slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return { ok: false, error: msg || "Failed to update category" };
  }
}

export async function deleteCategory(categoryId: string) {
  const [existing] = await db
    .select({ barId: menuCategories.barId })
    .from(menuCategories)
    .where(eq(menuCategories.id, categoryId));
  if (!existing) return; // sudah hilang

  await requireAdminForBar(existing.barId);

  // Kumpulkan id kategori ini + semua sub-kategorinya (item cuma di leaf, tapi
  // kategori utama pun bisa punya item langsung utk data lama).
  const subs = await db
    .select({ id: menuCategories.id })
    .from(menuCategories)
    .where(eq(menuCategories.parentId, categoryId));
  const catIds = [categoryId, ...subs.map((s) => s.id)];

  // Blokir kalau masih ada item di kategori ini atau sub-kategorinya.
  const [first] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(inArray(menuItems.categoryId, catIds))
    .limit(1);
  if (first) {
    throw new Error(
      "This category still has items. Move or delete the items first."
    );
  }

  try {
    await db.delete(menuCategories).where(eq(menuCategories.id, categoryId));
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "23503") {
      throw new Error(
        "This category is still in use and can't be deleted yet."
      );
    }
    throw new Error("Failed to delete category");
  }
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
  if (!row) throw new Error("Category not found");
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
      throw new Error(`Image is too large (max ${MAX_BYTES / 1024 / 1024}MB)`);
    }
    const heic = isHeicFile(file);
    const validMime = ACCEPTED_TYPES.includes(
      file.type as (typeof ACCEPTED_TYPES)[number]
    );
    if (!validMime && !heic) {
      throw new Error("File format must be JPG, PNG, WebP, or HEIC");
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
  if (typeof id !== "string") throw new Error("Invalid item ID");

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
      price: menuItems.price,
      name: menuItems.name,
    })
    .from(menuItems)
    .where(eq(menuItems.id, id));
  if (!existing) throw new Error("Item not found");

  const barId = await resolveBarIdForCategory(meta.categoryId);
  const { profile } = await requireAdminForBar(barId);

  // Kalau pindah kategori, verify kategori baru juga milik bar yang sama
  if (existing.categoryId !== meta.categoryId) {
    const oldBarId = await resolveBarIdForCategory(existing.categoryId);
    if (oldBarId !== barId) {
      throw new Error("Cannot move item to another bar");
    }
  }

  let imageUrl = existing.imageUrl;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      throw new Error(`Image is too large (max ${MAX_BYTES / 1024 / 1024}MB)`);
    }
    const heic = isHeicFile(file);
    const validMime = ACCEPTED_TYPES.includes(
      file.type as (typeof ACCEPTED_TYPES)[number]
    );
    if (!validMime && !heic) {
      throw new Error("File format must be JPG, PNG, WebP, or HEIC");
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

  // Audit: perubahan menu, terutama HARGA (paling perlu diawasi).
  const priceChanged = existing.price !== meta.price;
  await logActivity({
    actorId: profile.id,
    barId,
    action: priceChanged ? "menu.price_changed" : "menu.updated",
    category: "admin",
    summary: priceChanged
      ? `Changed price of ${meta.name.trim()}: ${formatIDR(existing.price)} to ${formatIDR(meta.price)}`
      : `Updated menu item ${meta.name.trim()}`,
    entityType: "menu_item",
    entityId: id,
    meta: priceChanged
      ? { priceBefore: existing.price, priceAfter: meta.price }
      : {},
  });

  revalidatePath("/admin/menu");
}

/**
 * Hasil hapus menu. Sengaja RETURN, bukan throw: pesan dari Error yang
 * dilempar server action DISENSOR Next.js di build produksi ("An error
 * occurred in the Server Components render…"), sehingga admin tak pernah
 * tahu alasan gagalnya. Nilai yang di-return tidak disensor.
 */
export interface DeleteMenuItemResult {
  ok: boolean;
  error?: string;
}

export async function deleteMenuItem(
  itemId: string
): Promise<DeleteMenuItemResult> {
  const [existing] = await db
    .select({
      id: menuItems.id,
      imageUrl: menuItems.imageUrl,
      categoryId: menuItems.categoryId,
    })
    .from(menuItems)
    .where(eq(menuItems.id, itemId));
  if (!existing) return { ok: true };

  const barId = await resolveBarIdForCategory(existing.categoryId);
  await requireAdminForBar(barId);

  // CEK DULU: item yg sudah pernah dipesan (ada di order_items, FK restrict)
  // tak bisa dihapus — beri pesan jelas SEBELUM query delete (andal di
  // production, tak bergantung pada menangkap error DB mentah).
  const [ordered] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.menuItemId, itemId))
    .limit(1);
  if (ordered) {
    return {
      ok: false,
      error:
        "This item has already been ordered by customers, so it can't be deleted (order history would break). Turn it off with the availability toggle instead to hide it from the menu.",
    };
  }

  try {
    await db.delete(menuItems).where(eq(menuItems.id, itemId));
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "23503") {
      return {
        ok: false,
        error:
          "This item is still referenced elsewhere, so it can't be deleted. Turn it off with the availability toggle instead.",
      };
    }
    // Fallback — JANGAN bocorkan err.message (bisa berisi query mentah).
    console.error("[deleteMenuItem] unexpected error:", err);
    return { ok: false, error: "Failed to delete item. Please try again." };
  }

  // Hapus foto SETELAH row terhapus (best-effort) supaya tak kehilangan foto
  // kalau delete di atas gagal.
  if (existing.imageUrl) {
    const { storage } = await import("@/lib/storage");
    await storage.delete(existing.imageUrl).catch(() => {});
  }
  revalidatePath("/admin/menu");
  return { ok: true };
}

/**
 * Toggle availability — operasi cepat tanpa modal (stock habis sementara).
 */
export async function toggleItemAvailability(
  itemId: string,
  isAvailable: boolean
): Promise<void> {
  const [existing] = await db
    .select({ categoryId: menuItems.categoryId, name: menuItems.name })
    .from(menuItems)
    .where(eq(menuItems.id, itemId));
  if (!existing) throw new Error("Item not found");

  const barId = await resolveBarIdForCategory(existing.categoryId);
  const { profile } = await requireAdminForBar(barId);

  await db
    .update(menuItems)
    .set({ isAvailable })
    .where(eq(menuItems.id, itemId));

  await logActivity({
    actorId: profile.id,
    barId,
    action: "menu.availability",
    category: "admin",
    summary: `${isAvailable ? "Enabled" : "Disabled"} menu item ${existing.name}`,
    entityType: "menu_item",
    entityId: itemId,
    meta: { isAvailable },
  });

  revalidatePath("/admin/menu");
}
