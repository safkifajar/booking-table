"use server";

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { prompts } from "@/lib/db/schema/prompts";
import { requireAdmin } from "@/lib/admin";
import { isDbConstraintError } from "@/lib/utils";

/**
 * Server Actions untuk master pertanyaan prompt (ice-breaker) onboarding.
 * Pola sama dgn hobby-actions. Dipilih customer di onboarding/edit profil.
 */

export interface PromptItem {
  id: string;
  text: string;
  sort_order: number;
}

// ============================================================
// READ
// ============================================================

/** Daftar prompt (urut sortOrder → text). */
export async function getPrompts(): Promise<PromptItem[]> {
  const rows = await db
    .select()
    .from(prompts)
    .orderBy(asc(prompts.sortOrder), asc(prompts.text));
  return rows.map((r) => ({ id: r.id, text: r.text, sort_order: r.sortOrder }));
}

/** Daftar teks prompt saja (untuk inject ke PromptPicker.options). */
export async function getPromptTexts(): Promise<string[]> {
  const rows = await getPrompts();
  return rows.map((r) => r.text);
}

// ============================================================
// CRUD
// ============================================================

const addSchema = z.object({
  text: z.string().min(1, "Prompt text is required").max(120),
});

export async function addPrompt(
  input: z.infer<typeof addSchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const data = addSchema.parse(input);
  try {
    await db.insert(prompts).values({ text: data.text.trim(), sortOrder: 999 });
  } catch (err) {
    // Helper bersama: memeriksa err.constraint_name DAN err.cause.
    if (isDbConstraintError(err, "uq_prompt_text")) {
      return { ok: false, error: "This prompt already exists" };
    }
    throw err;
  }
  revalidatePath("/admin/prompts");
  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(120),
});

export async function updatePrompt(
  input: z.infer<typeof updateSchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const data = updateSchema.parse(input);
  try {
    await db
      .update(prompts)
      .set({ text: data.text.trim() })
      .where(eq(prompts.id, data.id));
  } catch (err) {
    if (isDbConstraintError(err, "uq_prompt_text")) {
      return { ok: false, error: "Prompt text is already used" };
    }
    throw err;
  }
  revalidatePath("/admin/prompts");
  return { ok: true };
}

export async function deletePrompt(id: string) {
  await requireAdmin();
  await db.delete(prompts).where(eq(prompts.id, id));
  revalidatePath("/admin/prompts");
}
