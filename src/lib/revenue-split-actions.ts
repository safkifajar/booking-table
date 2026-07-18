"use server";

/**
 * Server Actions — halaman private Bagi Hasil (PRD bagi-hasil rev-2, Fase 2).
 * Guard: requireAdmin (halaman tetap TANPA entry point di menu — akses via
 * URL langsung; keputusan user: tanpa whitelist email).
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
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getChargeConfig } from "@/lib/settings-actions";
import { getBarBySlug } from "@/lib/queries";
import { backfillRevenueSplits } from "@/lib/revenue-split";

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
  await requireAdmin();
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
        // Sink tidak pakai persen — 0 sah.
        percent: z.number().min(0).max(100),
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
  await requireAdmin();
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

  // Tanggal efektif BOLEH mundur (rev — ekspektasi user: simpan → langsung
  // lihat rekap bulan berjalan dari transaksi yang sudah ada; backfill
  // otomatis mengisi sejak tanggal ini).
  const effectiveAt = new Date(`${data.effectiveAt}T00:00:00`);
  if (Number.isNaN(effectiveAt.getTime())) {
    return { ok: false, error: "Invalid effective date" };
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

  // Auto-backfill: hitung split semua pembayaran PAID sejak tanggal efektif
  // (yang sudah punya entries dilewati — idempotent) → rekap bulan berjalan
  // langsung terisi begitu simpan.
  await backfillRevenueSplits().catch((e) =>
    console.error("[split] auto-backfill:", e)
  );

  revalidatePath("/admin/revenue-split");
  return { ok: true, version };
}

/** Backfill split yang bolong (tombol di halaman private). */
export async function runSplitBackfill(): Promise<{ processed: number }> {
  await requireAdmin();
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

// ============================================================
// FASE 3 — SETTLEMENT (rekap bulanan per kategori, G4)
// ============================================================

export interface SplitPeriodRow {
  period: string; // "YYYY-MM"
  categories: {
    name: string;
    total: number;
    settled: boolean;
    settled_total: number | null;
  }[];
  source_count: number;
}

export async function getSplitSettlementReport(): Promise<SplitPeriodRow[]> {
  await requireAdmin();
  const { splitEntries, splitSettlements } = await import(
    "@/lib/db/schema/revenue-split"
  );
  const { sql } = await import("drizzle-orm");

  const rows = await db
    .select({
      period: sql<string>`to_char(${splitEntries.paidAt}, 'YYYY-MM')`,
      category: splitEntries.categoryName,
      total: sql<number>`SUM(${splitEntries.amount})::int`,
      sources: sql<number>`COUNT(DISTINCT ${splitEntries.sourceId})::int`,
    })
    .from(splitEntries)
    .groupBy(sql`to_char(${splitEntries.paidAt}, 'YYYY-MM')`, splitEntries.categoryName)
    .orderBy(sql`to_char(${splitEntries.paidAt}, 'YYYY-MM') DESC`);

  const settled = await db.select().from(splitSettlements);
  const settledMap = new Map(
    settled.map((s) => [`${s.period}|${s.categoryName}`, s.total])
  );

  const byPeriod = new Map<string, SplitPeriodRow>();
  for (const r of rows) {
    let p = byPeriod.get(r.period);
    if (!p) {
      p = { period: r.period, categories: [], source_count: 0 };
      byPeriod.set(r.period, p);
    }
    const st = settledMap.get(`${r.period}|${r.category}`);
    p.categories.push({
      name: r.category,
      total: Number(r.total),
      settled: st != null,
      settled_total: st ?? null,
    });
    p.source_count = Math.max(p.source_count, Number(r.sources));
  }
  return Array.from(byPeriod.values());
}

/** Tandai satu periode SETTLED (semua kategorinya; idempotent per kategori). */
export async function markSplitPeriodSettled(
  period: string
): Promise<{ ok: true; marked: number } | { ok: false; error: string }> {
  await requireAdmin();
  const me = await getCurrentProfile();
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, error: "Bad period" };

  const { splitEntries, splitSettlements } = await import(
    "@/lib/db/schema/revenue-split"
  );
  const { sql } = await import("drizzle-orm");
  const totals = await db
    .select({
      category: splitEntries.categoryName,
      total: sql<number>`SUM(${splitEntries.amount})::int`,
    })
    .from(splitEntries)
    .where(sql`to_char(${splitEntries.paidAt}, 'YYYY-MM') = ${period}`)
    .groupBy(splitEntries.categoryName);
  if (totals.length === 0) return { ok: false, error: "No entries in this period" };

  let marked = 0;
  for (const t of totals) {
    const ins = await db
      .insert(splitSettlements)
      .values({
        period,
        categoryName: t.category,
        total: Number(t.total),
        settledBy: me?.id ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: splitSettlements.id });
    marked += ins.length;
  }
  await db.insert(splitAuditLog).values({
    actorId: me?.id ?? null,
    action: "settlement.mark",
    before: null,
    after: { period, totals },
  });
  revalidatePath("/admin/revenue-split");
  return { ok: true, marked };
}

export interface SplitEntryRow {
  paid_at: string;
  source: "bill" | "membership";
  category: string;
  amount: number;
  kind: "split" | "reversal";
}

/** Drilldown entries satu periode (terbaru dulu, max 200). */
export async function getSplitPeriodEntries(
  period: string
): Promise<SplitEntryRow[]> {
  await requireAdmin();
  if (!/^\d{4}-\d{2}$/.test(period)) return [];
  const { splitEntries } = await import("@/lib/db/schema/revenue-split");
  const { sql, desc: d } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(splitEntries)
    .where(sql`to_char(${splitEntries.paidAt}, 'YYYY-MM') = ${period}`)
    .orderBy(d(splitEntries.paidAt))
    .limit(200);
  return rows.map((r) => ({
    paid_at: r.paidAt.toISOString(),
    source: r.source,
    category: r.categoryName,
    amount: r.amount,
    kind: r.kind,
  }));
}

/** Rekap per RENTANG tanggal (inklusif) — permintaan user: setelah simpan,
 *  tampilkan nilai pembagian utk range yang di-set. */
export async function getSplitRangeReport(input: {
  from: string; // YYYY-MM-DD
  to: string;
}): Promise<{ category: string; total: number }[]> {
  await requireAdmin();
  const { splitEntries } = await import("@/lib/db/schema/revenue-split");
  const { sql } = await import("drizzle-orm");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
    return [];
  }
  const rows = await db
    .select({
      category: splitEntries.categoryName,
      total: sql<number>`SUM(${splitEntries.amount})::int`,
    })
    .from(splitEntries)
    .where(
      sql`${splitEntries.paidAt} >= ${input.from}::date AND ${splitEntries.paidAt} < (${input.to}::date + interval '1 day')`
    )
    .groupBy(splitEntries.categoryName)
    .orderBy(sql`SUM(${splitEntries.amount}) DESC`);
  return rows.map((r) => ({ category: r.category, total: Number(r.total) }));
}

/** Data export per TRANSAKSI: service fee + pembagian per kategori. */
export async function getSplitExportRows(input: {
  from: string;
  to: string;
}): Promise<{
  categories: string[];
  rows: {
    paid_at: string;
    source: string;
    source_id: string;
    service: number;
    amounts: Record<string, number>;
  }[];
}> {
  await requireAdmin();
  const { splitEntries } = await import("@/lib/db/schema/revenue-split");
  const { sql, asc: a } = await import("drizzle-orm");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
    return { categories: [], rows: [] };
  }
  const entries = await db
    .select()
    .from(splitEntries)
    .where(
      sql`${splitEntries.paidAt} >= ${input.from}::date AND ${splitEntries.paidAt} < (${input.to}::date + interval '1 day')`
    )
    .orderBy(a(splitEntries.paidAt))
    .limit(5000);

  const catSet = new Set<string>();
  const bySource = new Map<string, {
    paid_at: string; source: string; source_id: string; service: number;
    amounts: Record<string, number>;
  }>();
  for (const e of entries) {
    catSet.add(e.categoryName);
    const key = `${e.source}|${e.sourceId}`;
    let row = bySource.get(key);
    if (!row) {
      row = {
        paid_at: e.paidAt.toISOString(),
        source: e.source,
        source_id: e.sourceId,
        service: 0,
        amounts: {},
      };
      bySource.set(key, row);
    }
    row.amounts[e.categoryName] = (row.amounts[e.categoryName] ?? 0) + e.amount;
    // service_collected sama utk semua baris satu sumber (reversal minus).
    if (e.kind === "split") row.service = e.serviceCollected;
    else row.service += e.serviceCollected;
  }
  return { categories: Array.from(catSet), rows: Array.from(bySource.values()) };
}

/**
 * REKAP LIVE (rev-3 — user hanya butuh rekap): hitung pembagian LANGSUNG
 * dari pembayaran paid di rentang, memakai persen dari FORM (tanpa perlu
 * simpan/versi). Sekaligus data export per transaksi.
 */
export async function getLiveSplitRecap(input: {
  from: string;
  to: string;
  categories: { name: string; percent: number; method: string | null; isRemainderSink: boolean }[];
}): Promise<{
  totals: { category: string; total: number }[];
  rows: { paid_at: string; source: string; source_id: string; method: string; service: number; amounts: Record<string, number> }[];
}> {
  await requireAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
    return { totals: [], rows: [] };
  }
  const { payments, orders } = await import("@/lib/db/schema/orders");
  const { membershipTransactions } = await import("@/lib/db/schema/membership-transactions");
  const { sql, and: A, eq: E, asc: a } = await import("drizzle-orm");

  const bar = await getBarBySlug(process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto");
  const cfg = bar ? await getChargeConfig(bar.id) : null;
  const taxPct = cfg?.taxEnabled !== false ? (cfg?.taxPercent ?? 0) : 0;
  const svcPct = cfg?.serviceEnabled !== false ? (cfg?.servicePercent ?? 0) : 0;
  const denom = 100 + taxPct + svcPct;

  const range = (col: unknown) =>
    sql`${col} >= ${input.from}::date AND ${col} < (${input.to}::date + interval '1 day')`;

  const bills = await db
    .select({ id: payments.id, amount: payments.amount, method: payments.method, paidAt: payments.paidAt })
    .from(payments)
    .innerJoin(orders, E(orders.id, payments.orderId))
    .where(A(E(payments.status, "paid"), sql`${payments.method} <> 'voucher'`, range(payments.paidAt)))
    .orderBy(a(payments.paidAt))
    .limit(5000);
  const members = await db
    .select({ id: membershipTransactions.id, base: membershipTransactions.baseAmount, service: membershipTransactions.serviceAmount, method: membershipTransactions.method, paidAt: membershipTransactions.paidAt })
    .from(membershipTransactions)
    .where(A(E(membershipTransactions.status, "paid"), range(membershipTransactions.paidAt)))
    .limit(2000);

  const totalsMap = new Map<string, number>();
  const rows: { paid_at: string; source: string; source_id: string; method: string; service: number; amounts: Record<string, number> }[] = [];

  // displayMethod: metode asli utk ditampilkan (mis. membership 'admin'
  // di-match sebagai cash tapi tetap tampil 'admin' di export).
  function apply(source: string, id: string, paidAt: Date, base: number, service: number, method: string, displayMethod = method) {
    const amounts: Record<string, number> = {};
    let allocated = 0;
    let sink: string | null = null;
    for (const c of input.categories) {
      if (c.isRemainderSink) { sink = c.name; continue; }
      if (c.method && c.method !== method) continue;
      const amt = Math.round((base * Math.round(c.percent * 1000)) / 100_000);
      amounts[c.name] = (amounts[c.name] ?? 0) + amt;
      allocated += amt;
    }
    if (sink) amounts[sink] = (amounts[sink] ?? 0) + (service - allocated);
    for (const [k, v] of Object.entries(amounts)) totalsMap.set(k, (totalsMap.get(k) ?? 0) + v);
    rows.push({ paid_at: paidAt.toISOString(), source, source_id: id, method: displayMethod, service, amounts });
  }

  for (const p of bills) {
    const base = Math.round((p.amount * 100) / denom);
    const service = Math.round((p.amount * svcPct) / denom);
    apply("bill", p.id, p.paidAt ?? new Date(), base, service, p.method);
  }
  for (const m of members) {
    apply("membership", m.id, m.paidAt ?? new Date(), m.base, m.service, m.method === "admin" ? "cash" : m.method, m.method);
  }

  return {
    totals: Array.from(totalsMap, ([category, total]) => ({ category, total })).sort((x, y) => y.total - x.total),
    rows,
  };
}
