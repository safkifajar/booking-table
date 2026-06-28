"use server";

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { hobbies } from "@/lib/db/schema/hobbies";
import { requireAdmin } from "@/lib/admin";
import {
  HOBBY_CATEGORY_OPTIONS,
  type HobbyItem,
  type HobbyGroup,
} from "@/lib/hobbies";

/** Semua hobi, dikelompokkan per kategori (urut sort_order). Untuk profil/onboarding/admin. */
export async function getHobbyGroups(): Promise<HobbyGroup[]> {
  const rows = await db
    .select()
    .from(hobbies)
    .orderBy(asc(hobbies.category), asc(hobbies.sortOrder), asc(hobbies.name));

  const byCat = new Map<string, HobbyItem[]>();
  for (const r of rows) {
    const item: HobbyItem = {
      id: r.id,
      name: r.name,
      category: r.category,
      sort_order: r.sortOrder,
    };
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(item);
  }
  // Urutkan kategori sesuai opsi tetap dulu, sisanya di belakang.
  const ordered: HobbyGroup[] = [];
  for (const cat of HOBBY_CATEGORY_OPTIONS) {
    if (byCat.has(cat)) {
      ordered.push({ category: cat, items: byCat.get(cat)! });
      byCat.delete(cat);
    }
  }
  for (const [category, items] of byCat) ordered.push({ category, items });
  return ordered;
}

const addSchema = z.object({
  name: z.string().min(1, "Nama wajib").max(40),
  category: z.string().min(1).max(60),
});

export async function addHobby(input: z.infer<typeof addSchema>) {
  await requireAdmin();
  const data = addSchema.parse(input);
  const name = data.name.trim().toLowerCase();

  try {
    await db.insert(hobbies).values({
      name,
      category: data.category.trim(),
      sortOrder: 999,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("uq_hobby_name")) {
      throw new Error("Hobi ini sudah ada");
    }
    throw err;
  }
  revalidatePath("/admin/hobbies");
}

export async function deleteHobby(id: string) {
  await requireAdmin();
  await db.delete(hobbies).where(eq(hobbies.id, id));
  revalidatePath("/admin/hobbies");
}

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(40),
  category: z.string().min(1).max(60),
});

export async function updateHobby(input: z.infer<typeof updateSchema>) {
  await requireAdmin();
  const data = updateSchema.parse(input);
  try {
    await db
      .update(hobbies)
      .set({ name: data.name.trim().toLowerCase(), category: data.category.trim() })
      .where(eq(hobbies.id, data.id));
  } catch (err) {
    if (err instanceof Error && err.message.includes("uq_hobby_name")) {
      throw new Error("Nama hobi sudah dipakai");
    }
    throw err;
  }
  revalidatePath("/admin/hobbies");
}
