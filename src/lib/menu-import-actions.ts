"use server";

/**
 * Server Actions untuk bulk import Menu Categories & Items via CSV/Excel.
 *
 * Format spec:
 *
 * CATEGORIES (csv/xlsx):
 *   Header row: name, is_active
 *   Example:
 *     name,is_active
 *     Coffee,true
 *     Cocktail,true
 *
 * ITEMS (csv/xlsx):
 *   Header row: category_name, name, description, price, tags, is_available, image
 *   Example:
 *     category_name,name,description,price,tags,is_available,image
 *     Coffee,Americano,Espresso + water,25000,"hot,coffee",true,americano.jpg
 *     Coffee,Latte,,30000,coffee,true,
 *
 * Untuk items dengan image:
 *   - Upload file ZIP yang berisi file CSV/Excel + folder images
 *   - Kolom `image` di CSV berisi nama file (mis. "americano.jpg")
 *   - Server cari file itu di ZIP, resize, upload ke storage
 *
 * Validation: all-or-nothing transaction. Kalau ada row invalid, batal semua.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
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
  if (!staff) throw new Error("Admin access required");
  if (staff.role !== "admin" && staff.role !== "manager") {
    throw new Error("Only admin/manager can import the menu");
  }
  return { profile, role: staff.role };
}

// ============================================================
// SLUG HELPER
// ============================================================

async function generateUniqueSlug(
  barId: string,
  name: string,
  takenSlugsInBatch: Set<string>
): Promise<string> {
  const baseSlug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) || "kategori";

  const existing = await db
    .select({ slug: menuCategories.slug })
    .from(menuCategories)
    .where(eq(menuCategories.barId, barId));
  const takenInDb = new Set(existing.map((r) => r.slug));

  function isTaken(s: string) {
    return takenInDb.has(s) || takenSlugsInBatch.has(s);
  }

  if (!isTaken(baseSlug)) {
    takenSlugsInBatch.add(baseSlug);
    return baseSlug;
  }
  let n = 2;
  while (isTaken(`${baseSlug}-${n}`)) n++;
  const finalSlug = `${baseSlug}-${n}`;
  takenSlugsInBatch.add(finalSlug);
  return finalSlug;
}

// ============================================================
// PARSE HELPER (CSV / Excel)
// ============================================================

interface ParsedRow {
  [key: string]: string;
}

/**
 * Parse Buffer dari CSV atau XLSX → array of records (string keys).
 * Auto-detect format berdasarkan nama file.
 */
async function parseTableFile(
  buffer: Buffer,
  filename: string
): Promise<ParsedRow[]> {
  const lower = filename.toLowerCase();
  const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xls");
  const isCsv = lower.endsWith(".csv");
  if (!isExcel && !isCsv) {
    throw new Error("File format must be CSV (.csv) or Excel (.xlsx)");
  }

  // Dynamic import untuk tidak bloat bundle
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("File is empty or has no sheet");

  const rows = xlsx.utils.sheet_to_json<ParsedRow>(sheet, {
    raw: false,
    defval: "",
  });
  return rows;
}

function normalizeBool(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.toString().toLowerCase().trim();
  return s === "true" || s === "1" || s === "yes" || s === "ya";
}

function normalizePrice(v: string | undefined): number {
  if (!v) return 0;
  // Strip Rp, koma, titik, spasi (assume integer rupiah)
  const cleaned = v.toString().replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function normalizeTags(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .toString()
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

// ============================================================
// IMPORT CATEGORIES
// ============================================================

export interface ImportCategoriesResult {
  inserted: number;
}

/**
 * Import categories dari CSV/Excel.
 * Format: `name`, `is_active` (boolean, default true)
 */
export async function importCategories(
  formData: FormData
): Promise<ImportCategoriesResult> {
  const barId = formData.get("barId");
  if (typeof barId !== "string") throw new Error("barId is required");
  await requireAdminForBar(barId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A CSV/Excel file must be uploaded");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("File is too large (max 5MB)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rows = await parseTableFile(buffer, file.name);

  if (rows.length === 0) {
    throw new Error("File has no data (header only)");
  }
  if (rows.length > 200) {
    throw new Error("Maximum 200 categories per import");
  }

  // Validate & prepare
  const takenSlugsInBatch = new Set<string>();
  const prepared: Array<{
    name: string;
    slug: string;
    isActive: boolean;
  }> = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2: 1-based + skip header
    const name = (row.name ?? row.Name ?? "").toString().trim();
    if (!name) {
      throw new Error(`Row ${rowNum}: column "name" is required`);
    }
    if (name.length > 60) {
      throw new Error(`Row ${rowNum}: name can be at most 60 characters`);
    }
    if (seenNames.has(name.toLowerCase())) {
      throw new Error(`Row ${rowNum}: name "${name}" is duplicated in the file`);
    }
    seenNames.add(name.toLowerCase());

    const slug = await generateUniqueSlug(barId, name, takenSlugsInBatch);
    const isActive = normalizeBool(row.is_active);

    prepared.push({ name, slug, isActive });
  }

  // All-or-nothing insert
  await db.transaction(async (tx) => {
    for (const p of prepared) {
      await tx.insert(menuCategories).values({
        barId,
        name: p.name,
        slug: p.slug,
        isActive: p.isActive,
      });
    }
  });

  revalidatePath("/admin/menu");
  return { inserted: prepared.length };
}

// ============================================================
// IMPORT ITEMS (dengan optional ZIP berisi images)
// ============================================================

export interface ImportItemsResult {
  inserted: number;
  imagesUploaded: number;
}

const ACCEPTED_IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface PreparedItem {
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  tags: string[];
  isAvailable: boolean;
  imageBuffer: Buffer | null;
  imageFilename: string | null;
}

/**
 * Import items dari CSV/Excel (text-only) ATAU ZIP berisi CSV + images folder.
 *
 * Format CSV/Excel:
 *   category_name, name, description, price, tags, is_available, image
 *
 * Format ZIP (mode dengan images):
 *   - 1 file CSV/Excel di root
 *   - File-file image bisa di root atau dalam folder apapun
 *   - Kolom `image` di CSV = nama file image (case-insensitive match)
 */
export async function importMenuItems(
  formData: FormData
): Promise<ImportItemsResult> {
  const barId = formData.get("barId");
  if (typeof barId !== "string") throw new Error("barId is required");
  await requireAdminForBar(barId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A file must be uploaded");
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new Error("File is too large (max 100MB)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  const isZip = lower.endsWith(".zip");

  // Parse CSV + image map
  let csvBuffer: Buffer;
  let csvFilename: string;
  let imageMap: Map<string, Buffer>;

  if (isZip) {
    const result = await extractZip(buffer);
    csvBuffer = result.csvBuffer;
    csvFilename = result.csvFilename;
    imageMap = result.imageMap;
  } else {
    csvBuffer = buffer;
    csvFilename = file.name;
    imageMap = new Map();
  }

  const rows = await parseTableFile(csvBuffer, csvFilename);
  if (rows.length === 0) {
    throw new Error("File has no data (header only)");
  }
  if (rows.length > 1000) {
    throw new Error("Maximum 1000 items per import");
  }

  // Load categories untuk match by name
  const categoryRows = await db
    .select({ id: menuCategories.id, name: menuCategories.name })
    .from(menuCategories)
    .where(eq(menuCategories.barId, barId));
  const categoryByName = new Map(
    categoryRows.map((c) => [c.name.toLowerCase().trim(), c.id])
  );

  // Validate semua row (all-or-nothing)
  const prepared: PreparedItem[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const categoryName = (row.category_name ?? row.Category ?? "")
      .toString()
      .trim();
    const name = (row.name ?? row.Name ?? "").toString().trim();

    if (!categoryName) {
      throw new Error(`Row ${rowNum}: column "category_name" is required`);
    }
    if (!name) {
      throw new Error(`Row ${rowNum}: column "name" is required`);
    }
    if (name.length > 80) {
      throw new Error(`Row ${rowNum}: name can be at most 80 characters`);
    }

    const categoryId = categoryByName.get(categoryName.toLowerCase());
    if (!categoryId) {
      throw new Error(
        `Row ${rowNum}: category "${categoryName}" not found. Create it first in the Categories tab.`
      );
    }

    const price = normalizePrice(row.price);
    if (price < 0 || price > 10_000_000) {
      throw new Error(`Row ${rowNum}: invalid price (${row.price})`);
    }

    const description = (row.description ?? "").toString().trim() || null;
    const tags = normalizeTags(row.tags);
    const isAvailable = normalizeBool(row.is_available);

    // Image handling
    let imageBuffer: Buffer | null = null;
    let imageFilename: string | null = null;
    const imageRef = (row.image ?? "").toString().trim();
    if (imageRef) {
      if (!isZip) {
        throw new Error(
          `Row ${rowNum}: the image column can only be used when uploading a ZIP`
        );
      }
      const found = imageMap.get(imageRef.toLowerCase());
      if (!found) {
        throw new Error(
          `Row ${rowNum}: image file "${imageRef}" not found in the ZIP`
        );
      }
      if (found.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(
          `Row ${rowNum}: image "${imageRef}" is too large (max 10MB)`
        );
      }
      imageBuffer = found;
      imageFilename = imageRef;
    }

    prepared.push({
      categoryId,
      name,
      description,
      price,
      tags,
      isAvailable,
      imageBuffer,
      imageFilename,
    });
  }

  // Process: insert + upload images dalam transaction.
  // Upload image dilakukan SETELAH insert sukses (storage upload tidak rollback-able).
  // Strategy: insert semua dulu (transaction), lalu upload images & update imageUrl.
  let imagesUploaded = 0;
  const inserted: Array<{ id: string; buffer: Buffer | null; ext: string }> =
    [];

  await db.transaction(async (tx) => {
    for (const p of prepared) {
      const [row] = await tx
        .insert(menuItems)
        .values({
          categoryId: p.categoryId,
          name: p.name,
          description: p.description,
          price: p.price,
          tags: p.tags,
          isAvailable: p.isAvailable,
          imageUrl: null,
        })
        .returning({ id: menuItems.id });
      inserted.push({
        id: row.id,
        buffer: p.imageBuffer,
        ext: p.imageFilename
          ? p.imageFilename.substring(p.imageFilename.lastIndexOf("."))
          : "",
      });
    }
  });

  // Upload images & update imageUrl (best-effort; kalau gagal individual,
  // log tapi item tetap exist tanpa image)
  if (inserted.some((i) => i.buffer)) {
    const { default: sharp } = await import("sharp");
    const { storage } = await import("@/lib/storage");

    for (const item of inserted) {
      if (!item.buffer) continue;
      try {
        const isHeic =
          item.ext.toLowerCase() === ".heic" ||
          item.ext.toLowerCase() === ".heif";
        let inputBuf = item.buffer;
        if (isHeic) {
          const { default: heicConvert } = await import("heic-convert");
          inputBuf = Buffer.from(
            await heicConvert({
              buffer: new Uint8Array(item.buffer),
              format: "JPEG",
              quality: 0.9,
            })
          );
        }
        const outputBuf = await sharp(inputBuf)
          .rotate()
          .resize(800, 800, { fit: "cover", position: "center" })
          .webp({ quality: 82 })
          .toBuffer();
        const { publicUrl } = await storage.upload({
          buffer: outputBuf,
          folder: "menu",
          key: item.id,
          contentType: "image/webp",
        });
        await db
          .update(menuItems)
          .set({ imageUrl: publicUrl })
          .where(eq(menuItems.id, item.id));
        imagesUploaded++;
      } catch (err) {
        // Log tapi continue — item tetap ada tanpa image
        console.error(`[importItems] image upload failed for ${item.id}:`, err);
      }
    }
  }

  revalidatePath("/admin/menu");
  return { inserted: inserted.length, imagesUploaded };
}

// ============================================================
// ZIP EXTRACTION
// ============================================================

interface ZipExtractResult {
  csvBuffer: Buffer;
  csvFilename: string;
  imageMap: Map<string, Buffer>; // key: lowercase basename
}

async function extractZip(buffer: Buffer): Promise<ZipExtractResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  let csvBuffer: Buffer | null = null;
  let csvFilename = "";
  const imageMap = new Map<string, Buffer>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const basename = path.split("/").pop() ?? path;
    const lower = basename.toLowerCase();

    // Skip macOS metadata folder
    if (path.startsWith("__MACOSX/") || basename.startsWith(".")) continue;

    if (
      (lower.endsWith(".csv") ||
        lower.endsWith(".xlsx") ||
        lower.endsWith(".xls")) &&
      !csvBuffer
    ) {
      csvBuffer = Buffer.from(await entry.async("nodebuffer"));
      csvFilename = basename;
      continue;
    }

    if (ACCEPTED_IMAGE_EXT.some((ext) => lower.endsWith(ext))) {
      const imageBuf = Buffer.from(await entry.async("nodebuffer"));
      imageMap.set(lower, imageBuf);
      // Juga simpan dengan key tanpa ekstensi (kalau ada multiple ext)
      // Skip — match harus exact filename + ext
    }
  }

  if (!csvBuffer) {
    throw new Error("ZIP has no CSV/Excel file in the root");
  }
  return { csvBuffer, csvFilename, imageMap };
}
