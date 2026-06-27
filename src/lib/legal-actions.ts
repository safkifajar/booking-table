"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { legalDocuments } from "@/lib/db/schema/legal";
import { requireAdmin } from "@/lib/admin";

export type LegalKey = "privacy" | "terms";

export interface LegalDoc {
  key: LegalKey;
  title: string;
  content: string;
  updated_at: string | null;
}

const DEFAULTS: Record<LegalKey, string> = {
  privacy: "Kebijakan Privasi",
  terms: "Syarat & Ketentuan",
};

/**
 * Ambil dokumen legal (privacy/terms) milik bar. Selalu return kedua key —
 * kalau belum ada di DB, kembalikan default kosong supaya admin bisa langsung
 * isi & publik tak error.
 */
export async function getLegalDocs(barId: string): Promise<Record<LegalKey, LegalDoc>> {
  const rows = await db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.barId, barId));

  const build = (key: LegalKey): LegalDoc => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      title: row?.title ?? DEFAULTS[key],
      content: row?.content ?? "",
      updated_at: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  };

  return { privacy: build("privacy"), terms: build("terms") };
}

/** Versi publik: 1 dokumen by key untuk halaman /privacy & /terms. */
export async function getPublicLegalDoc(
  barId: string,
  key: LegalKey
): Promise<LegalDoc> {
  const docs = await getLegalDocs(barId);
  return docs[key];
}

const upsertSchema = z.object({
  key: z.enum(["privacy", "terms"]),
  title: z.string().min(1, "Judul wajib").max(120),
  content: z.string().max(50000),
});

export async function upsertLegalDoc(input: z.infer<typeof upsertSchema>) {
  const bar = await requireAdmin();
  const data = upsertSchema.parse(input);

  await db
    .insert(legalDocuments)
    .values({
      barId: bar.id,
      key: data.key,
      title: data.title.trim(),
      content: data.content,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [legalDocuments.barId, legalDocuments.key],
      set: {
        title: data.title.trim(),
        content: data.content,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/admin/legal");
  revalidatePath(`/${data.key}`);
}
