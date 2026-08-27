import "server-only";

/**
 * Engine Bagi Hasil service fee (PRD bagi-hasil rev-2) — server-only lib,
 * BUKAN "use server": menulis ledger uang; tak boleh jadi endpoint client.
 *
 * Aturan inti:
 * - Basis SEMUA persen = porsi SUBTOTAL sumber (bukan nominal payment yang
 *   sudah termasuk tax&service) — konsisten dgn service% di Settings.
 * - Kategori ber-metode hanya berlaku utk payment metode tsb.
 * - Kategori penampung (sink) menyerap sisa & pembulatan — POSITIF ATAU
 *   MINUS (G6: service off tapi fee channel jalan → sink minus, jujur).
 *   Σ entries selalu = serviceCollected.
 * - Idempotent: UNIQUE(source, sourceId, category, kind) + onConflictDoNothing.
 * - Kegagalan di sini TIDAK boleh menggagalkan pembayaran — pemanggil
 *   membungkus try/catch; backfill menambal yang bolong.
 */

import { computeSplit, type SchemeCategory } from "@/lib/revenue-split-math";
// Diteruskan supaya pemakai lama tak perlu tahu perpindahan berkasnya.
export { computeSplit, type SchemeCategory };

import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  splitSchemes,
  splitSchemeCategories,
  splitEntries,
} from "@/lib/db/schema/revenue-split";
import { payments, orders } from "@/lib/db/schema/orders";
import { tableSessions } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { membershipTransactions } from "@/lib/db/schema/membership-transactions";
import { getChargeConfig } from "@/lib/settings-actions";
import { DEFAULT_CHARGE_CONFIG, type ChargeConfig } from "@/lib/settings-constants";


/** Skema aktif utk waktu paid tertentu (versi terbaru dgn effective_at <= t). */
export async function getActiveScheme(paidAt: Date): Promise<
  | { id: string; version: number; categories: SchemeCategory[] }
  | null
> {
  const [scheme] = await db
    .select({ id: splitSchemes.id, version: splitSchemes.version })
    .from(splitSchemes)
    .where(lte(splitSchemes.effectiveAt, paidAt))
    .orderBy(desc(splitSchemes.effectiveAt), desc(splitSchemes.version))
    .limit(1);
  if (!scheme) return null;
  const cats = await db
    .select({
      name: splitSchemeCategories.name,
      percentMilli: splitSchemeCategories.percentMilli,
      method: splitSchemeCategories.method,
      isRemainderSink: splitSchemeCategories.isRemainderSink,
    })
    .from(splitSchemeCategories)
    .where(eq(splitSchemeCategories.schemeId, scheme.id))
    .orderBy(asc(splitSchemeCategories.sortOrder));
  return { ...scheme, categories: cats };
}

/** Porsi subtotal & service dari nominal payment (yang sudah incl. charge). */
function shares(amount: number, cfg: ChargeConfig | null) {
  const c = cfg ?? DEFAULT_CHARGE_CONFIG;
  const taxPct = c.taxEnabled !== false ? c.taxPercent : 0;
  const svcPct = c.serviceEnabled !== false ? c.servicePercent : 0;
  const denom = 100 + taxPct + svcPct;
  const base = Math.round((amount * 100) / denom);
  const service = Math.round((amount * svcPct) / denom);
  return { base, service };
}

/**
 * Snapshot split utk BILL payment PAID. Idempotent; skip method 'voucher'
 * (potongan membership — bukan uang masuk, D3). Dipanggil dari semua
 * transisi paid, dibungkus try/catch oleh pemanggil.
 */
export async function settleRevenueSplitForPayment(
  paymentId: string
): Promise<void> {
  const [p] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      paidAt: payments.paidAt,
      barId: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p || p.status !== "paid" || p.method === "voucher") return;

  const paidAt = p.paidAt ?? new Date();
  const scheme = await getActiveScheme(paidAt);
  if (!scheme) return; // belum ada skema yang sah → tanpa split (G9)

  const cfg = await getChargeConfig(p.barId);
  const { base, service } = shares(p.amount, cfg);
  const rows = computeSplit({
    base,
    serviceCollected: service,
    method: p.method,
    categories: scheme.categories,
  });
  if (rows.length === 0) return;

  await db
    .insert(splitEntries)
    .values(
      rows.map((r) => ({
        source: "bill" as const,
        sourceId: p.id,
        schemeId: scheme.id,
        categoryName: r.category,
        amount: r.amount,
        serviceCollected: service,
        kind: "split" as const,
        paidAt,
      }))
    )
    .onConflictDoNothing();
}

/** Snapshot split utk transaksi MEMBERSHIP paid (G7). Basis snapshot eksak. */
export async function settleRevenueSplitForMembershipTx(
  txId: string
): Promise<void> {
  const [t] = await db
    .select({
      id: membershipTransactions.id,
      base: membershipTransactions.baseAmount,
      service: membershipTransactions.serviceAmount,
      method: membershipTransactions.method,
      status: membershipTransactions.status,
      paidAt: membershipTransactions.paidAt,
    })
    .from(membershipTransactions)
    .where(eq(membershipTransactions.id, txId))
    .limit(1);
  if (!t || t.status !== "paid") return;

  const paidAt = t.paidAt ?? new Date();
  const scheme = await getActiveScheme(paidAt);
  if (!scheme) return;

  const rows = computeSplit({
    base: t.base,
    serviceCollected: t.service,
    method: t.method === "admin" ? "cash" : t.method, // admin grant amount 0 → semua 0
    categories: scheme.categories,
  });
  if (rows.length === 0) return;

  await db
    .insert(splitEntries)
    .values(
      rows.map((r) => ({
        source: "membership" as const,
        sourceId: t.id,
        schemeId: scheme.id,
        categoryName: r.category,
        amount: r.amount,
        serviceCollected: t.service,
        kind: "split" as const,
        paidAt,
      }))
    )
    .onConflictDoNothing();
}

/**
 * Pembalik split (refund/void SETELAH paid) — baris minus, proporsi & skema
 * sama dgn snapshot asal. Idempotent (kind 'reversal' unik per kategori).
 * Belum ada transisi otomatis di app (refund = manual ops) — dipanggil dari
 * ops/halaman private bila diperlukan.
 */
export async function reverseRevenueSplit(
  source: "bill" | "membership",
  sourceId: string
): Promise<number> {
  const rows = await db
    .select()
    .from(splitEntries)
    .where(
      and(
        eq(splitEntries.source, source),
        eq(splitEntries.sourceId, sourceId),
        eq(splitEntries.kind, "split")
      )
    );
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(splitEntries)
    .values(
      rows.map((r) => ({
        source: r.source,
        sourceId: r.sourceId,
        schemeId: r.schemeId,
        categoryName: r.categoryName,
        amount: -r.amount,
        serviceCollected: -r.serviceCollected,
        kind: "reversal" as const,
        paidAt: new Date(),
      }))
    )
    .onConflictDoNothing()
    .returning({ id: splitEntries.id });
  return inserted.length;
}

/**
 * Backfill: isi split yang bolong (payment/membership PAID sejak skema
 * pertama efektif, tanpa entries — mis. gagal saat transisi). Dipanggil
 * dari halaman private. Return jumlah sumber yang diproses.
 */
export async function backfillRevenueSplits(limit = 500): Promise<number> {
  const [firstScheme] = await db
    .select({ effectiveAt: splitSchemes.effectiveAt })
    .from(splitSchemes)
    .orderBy(asc(splitSchemes.effectiveAt))
    .limit(1);
  if (!firstScheme) return 0;

  let processed = 0;

  const missingBills = await db
    .select({ id: payments.id })
    .from(payments)
    .leftJoin(
      splitEntries,
      and(
        eq(splitEntries.source, "bill"),
        eq(splitEntries.sourceId, payments.id),
        eq(splitEntries.kind, "split")
      )
    )
    .where(
      and(
        eq(payments.status, "paid"),
        sql`${payments.method} <> 'voucher'`,
        gte(payments.paidAt, firstScheme.effectiveAt),
        isNull(splitEntries.id)
      )
    )
    .groupBy(payments.id)
    .limit(limit);
  for (const b of missingBills) {
    await settleRevenueSplitForPayment(b.id);
    processed++;
  }

  const missingMemberships = await db
    .select({ id: membershipTransactions.id })
    .from(membershipTransactions)
    .leftJoin(
      splitEntries,
      and(
        eq(splitEntries.source, "membership"),
        eq(splitEntries.sourceId, membershipTransactions.id),
        eq(splitEntries.kind, "split")
      )
    )
    .where(
      and(
        eq(membershipTransactions.status, "paid"),
        gte(membershipTransactions.paidAt, firstScheme.effectiveAt),
        isNull(splitEntries.id)
      )
    )
    .groupBy(membershipTransactions.id)
    .limit(limit);
  for (const m of missingMemberships) {
    await settleRevenueSplitForMembershipTx(m.id);
    processed++;
  }

  return processed;
}
