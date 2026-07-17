"use server";

/**
 * Server Actions — halaman private Bagi Hasil (PRD bagi-hasil rev-2, Fase 2).
 * SEMUA action dijaga whitelist email (SPLIT_ADMIN_EMAILS) DI ATAS guard
 * admin — akun lain (termasuk admin biasa) ditolak seolah fitur tak ada.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  splitSchemes,
  splitSchemeCategories,
  splitAuditLog,
} from "@/lib/db/schema/revenue-split";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { getChargeConfig } from "@/lib/settings-actions";
import { getBarBySlug } from "@/lib/queries";
import { backfillRevenueSplits } from "@/lib/revenue-split";

/** Email di whitelist? (dipakai page utk notFound + semua action di sini). */
export async function isSplitAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user?.email) return false;
  const list = (process.env.SPLIT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(user.email.toLowerCase());
}

async function requireSplitAdmin() {
  await requireAdmin();
  if (!(await isSplitAdmin())) {
    // Pesan generik — keberadaan fitur tak boleh bocor.
    throw new Error("Not found");
  }
}

export interface SplitCategoryInput {
  name: string;
  /** Persen desimal (1,694) — dikonversi milipersen di server. */
  percent: number;
  method: string | null;
  isRemainderSink: boolean;
}

export interface SplitConfigView {
  /** Service % aktif dari Settings (read-only di form — sumber kebenaran). */
  service_percent: number;
  service_enabled: boolean;
  active: {
    version: number;
    effective_at: string;
    categories: {
      name: string;
      percent: number;
      method: string | null;
      is_remainder_sink: boolean;
    }[];
  } | null;
  versions: {
    version: number;
    effective_at: string;
    created_at: string;
    note: string | null;
    summary: string;
  }[];
}

export async function getSplitConfig(): Promise<SplitConfigView> {
  await requireSplitAdmin();
  const bar = await getBarBySlug(
    process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto"
  );
  const cfg = bar ? await getChargeConfig(bar.id) : null;

  const schemes = await db
    .select()
    .from(splitSchemes)
    .orderBy(desc(splitSchemes.version));
  const versions = [];
  let active: SplitConfigView["active"] = null;
  for (const sch of schemes) {
    const cats = await db
      .select()
      .from(splitSchemeCategories)
      .where(eq(splitSchemeCategories.schemeId, sch.id))
      .orderBy(asc(splitSchemeCategories.sortOrder));
    const summary = cats
      .map(
        (c) =>
          `${c.name} ${(c.percentMilli / 1000).toLocaleString("id-ID")}%${c.method ? ` [${c.method}]` : ""}${c.isRemainderSink ? " (sink)" : ""}`
      )
      .join(" · ");
    versions.push({
      version: sch.version,
      effective_at: sch.effectiveAt.toISOString(),
      created_at: sch.createdAt.toISOString(),
      note: sch.note,
      summary,
    });
    if (!active) {
      active = {
        version: sch.version,
        effective_at: sch.effectiveAt.toISOString(),
        categories: cats.map((c) => ({
          name: c.name,
          percent: c.percentMilli / 1000,
          method: c.method,
          is_remainder_sink: c.isRemainderSink,
        })),
      };
    }
  }
  return {
    service_percent: cfg?.servicePercent ?? 0,
    service_enabled: cfg?.serviceEnabled !== false,
    active,
    versions,
  };
}

const saveSchema = z.object({
  effectiveAt: z.string(), // "YYYY-MM-DD"
  note: z.string().trim().max(200).optional(),
  categories: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60),
        percent: z.number().positive().max(100),
        method: z.string().nullable(),
        isRemainderSink: z.boolean(),
      })
    )
    .min(1)
    .max(20),
});

export async function saveSplitScheme(
  input: z.infer<typeof saveSchema>
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  await requireSplitAdmin();
  const me = await getCurrentProfile();
  const data = saveSchema.parse(input);

  const sinks = data.categories.filter((c) => c.isRemainderSink);
  if (sinks.length !== 1) {
    return { ok: false, error: "Exactly one category must be the remainder sink" };
  }
  const names = new Set(data.categories.map((c) => c.name.toLowerCase()));
  if (names.size !== data.categories.length) {
    return { ok: false, error: "Category names must be unique" };
  }

  // Validasi inti (arahan user): Σ persen ≤ service % aktif di Settings.
  const bar = await getBarBySlug(
    process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto"
  );
  const cfg = bar ? await getChargeConfig(bar.id) : null;
  const servicePct = cfg?.serviceEnabled !== false ? (cfg?.servicePercent ?? 0) : 0;
  const totalPct = data.categories.reduce((s, c) => s + c.percent, 0);
  if (totalPct > servicePct + 1e-9) {
    return {
      ok: false,
      error: `Total (${totalPct.toFixed(3)}%) exceeds the service charge set in Settings (${servicePct}%)`,
    };
  }

  const effectiveAt = new Date(`${data.effectiveAt}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(effectiveAt.getTime()) || effectiveAt < today) {
    return { ok: false, error: "Effective date can't be in the past" };
  }

  const [last] = await db
    .select({ version: splitSchemes.version })
    .from(splitSchemes)
    .orderBy(desc(splitSchemes.version))
    .limit(1);
  const version = (last?.version ?? 0) + 1;

  await db.transaction(async (tx) => {
    const [scheme] = await tx
      .insert(splitSchemes)
      .values({
        version,
        effectiveAt,
        note: data.note || null,
        createdBy: me?.id ?? null,
      })
      .returning({ id: splitSchemes.id });
    await tx.insert(splitSchemeCategories).values(
      data.categories.map((c, i) => ({
        schemeId: scheme.id,
        name: c.name,
        percentMilli: Math.round(c.percent * 1000),
        method: (c.method || null) as never,
        isRemainderSink: c.isRemainderSink,
        sortOrder: i,
      }))
    );
    await tx.insert(splitAuditLog).values({
      actorId: me?.id ?? null,
      action: "scheme.create",
      before: null,
      after: { version, effectiveAt: data.effectiveAt, categories: data.categories },
    });
  });

  revalidatePath("/admin/revenue-split");
  return { ok: true, version };
}

/** Backfill split yang bolong (tombol di halaman private). */
export async function runSplitBackfill(): Promise<{ processed: number }> {
  await requireSplitAdmin();
  const me = await getCurrentProfile();
  const processed = await backfillRevenueSplits();
  await db.insert(splitAuditLog).values({
    actorId: me?.id ?? null,
    action: "backfill.run",
    before: null,
    after: { processed },
  });
  revalidatePath("/admin/revenue-split");
  return { processed };
}
