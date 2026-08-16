"use server";

import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { hobbies, hobbyCategories } from "@/lib/db/schema/hobbies";
import { requireAdmin } from "@/lib/admin";
import { isDbConstraintError } from "@/lib/utils";
import type { HobbyItem, HobbyGroup, HobbyCategory } from "@/lib/hobbies";

// ============================================================
// READ
// ============================================================

/** Semua kategori (urut sortOrder). */
export async function getHobbyCategories(): Promise<HobbyCategory[]> {
  const rows = await db
    .select()
    .from(hobbyCategories)
    .orderBy(asc(hobbyCategories.sortOrder), asc(hobbyCategories.name));
  return rows.map((r) => ({ id: r.id, name: r.name, sort_order: r.sortOrder }));
}

/** Hobi dikelompokkan per kategori (urut kategori → hobi). */
export async function getHobbyGroups(): Promise<HobbyGroup[]> {
  const [cats, rows] = await Promise.all([
    getHobbyCategories(),
    db
      .select()
      .from(hobbies)
      .orderBy(asc(hobbies.sortOrder), asc(hobbies.name)),
  ]);

  const byCat = new Map<string, HobbyItem[]>();
  for (const r of rows) {
    const item: HobbyItem = {
      id: r.id,
      name: r.name,
      category: r.category,
      emoji: r.emoji,
      sort_order: r.sortOrder,
    };
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(item);
  }
  const ordered: HobbyGroup[] = [];
  for (const c of cats) {
    ordered.push({ category: c.name, items: byCat.get(c.name) ?? [] });
    byCat.delete(c.name);
  }
  // Kategori "yatim" (hobi dgn kategori yg sudah dihapus) — tetap tampil.
  for (const [category, items] of byCat) ordered.push({ category, items });
  return ordered.filter((g) => g.items.length > 0 || cats.some((c) => c.name === g.category));
}

/** Daftar hobi flat (untuk tabel admin). */
export async function getHobbiesList(): Promise<HobbyItem[]> {
  const rows = await db
    .select()
    .from(hobbies)
    .orderBy(asc(hobbies.category), asc(hobbies.sortOrder), asc(hobbies.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    emoji: r.emoji,
    sort_order: r.sortOrder,
  }));
}

// ============================================================
// HOBBY CRUD
// ============================================================

const addHobbySchema = z.object({
  name: z.string().min(1, "Name is required").max(40),
  category: z.string().min(1, "Category is required").max(60),
  emoji: z.string().max(8).optional().or(z.literal("")),
});

export async function addHobby(
  input: z.infer<typeof addHobbySchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const data = addHobbySchema.parse(input);
  // Nama disimpan apa adanya (katalog SOHO Capitalized + emoji).
  const name = data.name.trim();
  try {
    await db.insert(hobbies).values({
      name,
      category: data.category.trim(),
      emoji: data.emoji?.trim() || null,
      sortOrder: 999,
    });
  } catch (err) {
    // Pakai helper bersama: ia memeriksa err.constraint_name DAN err.cause,
    // jadi tetap cocok walau driver/Next membungkus errornya.
    if (isDbConstraintError(err, "uq_hobby_name")) {
      return { ok: false, error: "This hobby already exists" };
    }
    throw err;
  }
  revalidatePath("/admin/hobbies");
  return { ok: true };
}

const updateHobbySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(40),
  category: z.string().min(1).max(60),
  emoji: z.string().max(8).optional().or(z.literal("")),
});

export async function updateHobby(
  input: z.infer<typeof updateHobbySchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const data = updateHobbySchema.parse(input);
  try {
    await db
      .update(hobbies)
      .set({
        name: data.name.trim(),
        category: data.category.trim(),
        emoji: data.emoji?.trim() || null,
      })
      .where(eq(hobbies.id, data.id));
  } catch (err) {
    // Pakai helper bersama: ia memeriksa err.constraint_name DAN err.cause,
    // jadi tetap cocok walau driver/Next membungkus errornya.
    if (isDbConstraintError(err, "uq_hobby_name")) {
      return { ok: false, error: "Hobby name is already used" };
    }
    throw err;
  }
  revalidatePath("/admin/hobbies");
  return { ok: true };
}

export async function deleteHobby(id: string) {
  await requireAdmin();
  await db.delete(hobbies).where(eq(hobbies.id, id));
  revalidatePath("/admin/hobbies");
}

// ============================================================
// CATEGORY CRUD
// ============================================================

const addCatSchema = z.object({ name: z.string().min(1, "Name is required").max(60) });

export async function addHobbyCategory(
  input: z.infer<typeof addCatSchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const data = addCatSchema.parse(input);
  try {
    await db
      .insert(hobbyCategories)
      .values({ name: data.name.trim(), sortOrder: 999 });
  } catch (err) {
    if (isDbConstraintError(err, "uq_hobby_category_name")) {
      return { ok: false, error: "This category already exists" };
    }
    throw err;
  }
  revalidatePath("/admin/hobbies");
  return { ok: true };
}

const updateCatSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
});

export async function updateHobbyCategory(
  input: z.infer<typeof updateCatSchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const data = updateCatSchema.parse(input);
  // Ambil nama lama untuk update hobi yg memakainya (jaga konsistensi).
  const [old] = await db
    .select({ name: hobbyCategories.name })
    .from(hobbyCategories)
    .where(eq(hobbyCategories.id, data.id));
  if (!old) throw new Error("Category not found");
  const newName = data.name.trim();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(hobbyCategories)
        .set({ name: newName })
        .where(eq(hobbyCategories.id, data.id));
      // Pindahkan hobi lama ke nama kategori baru.
      await tx
        .update(hobbies)
        .set({ category: newName })
        .where(eq(hobbies.category, old.name));
    });
  } catch (err) {
    // Nama kategori bentrok — sebelumnya lolos tanpa pesan yang jelas.
    if (isDbConstraintError(err, "uq_hobby_category_name")) {
      return { ok: false, error: "This category already exists" };
    }
    throw err;
  }
  revalidatePath("/admin/hobbies");
  return { ok: true };
}

export async function deleteHobbyCategory(id: string) {
  await requireAdmin();
  const [cat] = await db
    .select({ name: hobbyCategories.name })
    .from(hobbyCategories)
    .where(eq(hobbyCategories.id, id));
  if (!cat) return;
  // Cegah hapus kalau masih ada hobi di kategori ini.
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(hobbies)
    .where(eq(hobbies.category, cat.name));
  if (c > 0) {
    throw new Error(
      `There are still ${c} hobbies in this category. Move or delete them first.`
    );
  }
  await db.delete(hobbyCategories).where(eq(hobbyCategories.id, id));
  revalidatePath("/admin/hobbies");
}
