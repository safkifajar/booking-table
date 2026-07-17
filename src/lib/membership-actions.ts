"use server";

/**
 * Server Actions — Membership: sisi ADMIN (Fase 2) + PEMBELIAN customer
 * (Fase 3).
 *
 * Aturan yang DITEGAKKAN DI SINI:
 * - key & rank level IMMUTABLE (M2) — admin hanya mengubah name/price/
 *   billing_period/description; basic tak pernah purchasable & harga 0.
 * - Perubahan level customer oleh admin SELALU tercatat sebagai transaksi
 *   kind='admin_grant' (M8) — riwayat tak pernah bolong.
 * - Voucher hanya bisa DIHAPUS selama belum pernah dipakai; setelah dipakai
 *   jalur matinya adalah nonaktif (riwayat transaksi menunjuk ke sana).
 */

import { revalidatePath } from "next/cache";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  membershipLevels,
  membershipVouchers,
} from "@/lib/db/schema/membership";
import { membershipTransactions } from "@/lib/db/schema/membership-transactions";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { staffRoles } from "@/lib/db/schema/extras";
import { notifications } from "@/lib/db/schema/notifications";
import { requireAdmin } from "@/lib/admin";
import { getCurrentProfile, requireProfile } from "@/lib/auth-v2/current";
import { getPaymentGateway } from "@/lib/payments/gateway";
import { createNotification } from "@/lib/notifications";
import { getChargeConfig } from "@/lib/settings-actions";
import { getBarBySlug } from "@/lib/queries";
import { computeBillTotals } from "@/lib/settings-constants";
import { settleRevenueSplitForMembershipTx } from "@/lib/revenue-split";
import {
  generateMemberVouchers,
  getGeneratedCounts,
  getVouchersOf,
  templateHasInstances,
  resolveVoucherForBillPayment,
  type MyVoucherRow,
} from "@/lib/member-voucher";
import {
  effectiveLevelKey,
  type MembershipKey,
} from "@/lib/membership";

// ============================================================
// LEVEL — kelola nama/harga/periode (M3)
// ============================================================

const levelKeySchema = z.enum(["basic", "premium", "vip"]);

const updateLevelSchema = z.object({
  key: levelKeySchema,
  name: z.string().trim().min(2).max(40),
  price: z.number().int().min(0).max(100_000_000),
  billingPeriod: z.enum(["one_time", "monthly", "yearly"]),
  description: z.string().trim().max(280).optional(),
});

export async function updateMembershipLevel(
  input: z.infer<typeof updateLevelSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const data = updateLevelSchema.parse(input);

  // basic: gratis & non-purchasable selamanya — hanya nama+deskripsi yg ikut.
  const isBasic = data.key === "basic";
  await db
    .update(membershipLevels)
    .set({
      name: data.name,
      description: data.description || null,
      ...(isBasic
        ? {}
        : { price: data.price, billingPeriod: data.billingPeriod }),
      updatedAt: new Date(),
    })
    .where(eq(membershipLevels.key, data.key));

  revalidatePath("/admin/membership");
  revalidatePath("/membership");
  return { ok: true };
}

// ============================================================
// VOUCHER TEMPLATE — benefit member, BUKAN kode promo (M7 rev-2)
// ============================================================
// Admin membuat TEMPLATE (nama + aturan potongan bill + level); kode unik
// per member digenerate otomatis saat aktivasi (lib/member-voucher.ts).

const voucherTemplateSchema = z.object({
  name: z.string().trim().min(3).max(60),
  discountType: z.enum(["percent", "fixed"]),
  discountValue: z.number().int().min(1),
  /** Batas maksimal potongan (percent). null = tanpa batas. */
  maxDiscount: z.number().int().min(1).nullable(),
  /** Minimal nominal pembayaran. null = tanpa syarat. */
  minSpend: z.number().int().min(1).nullable(),
  /** null = semua level purchasable. */
  levelKey: z.enum(["premium", "vip"]).nullable(),
  /** Masa berlaku instance: X hari sejak diterima member. */
  validDays: z.number().int().min(1).max(3650),
  isActive: z.boolean(),
});

function validateTemplateFields(
  data: z.infer<typeof voucherTemplateSchema>
): string | null {
  if (data.discountType === "percent" && data.discountValue > 100) {
    return "Percent discount can't exceed 100";
  }
  return null;
}

export async function createMembershipVoucher(
  input: z.infer<typeof voucherTemplateSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const data = voucherTemplateSchema.parse(input);
  const err = validateTemplateFields(data);
  if (err) return { ok: false, error: err };

  await db.insert(membershipVouchers).values({
    name: data.name,
    discountType: data.discountType,
    discountValue: data.discountValue,
    maxDiscount: data.maxDiscount,
    minSpend: data.minSpend,
    levelKey: data.levelKey,
    validDays: data.validDays,
    isActive: data.isActive,
  });

  revalidatePath("/admin/membership/vouchers");
  return { ok: true };
}

const updateTemplateSchema = voucherTemplateSchema.extend({
  id: z.string().uuid(),
});

/**
 * Ubah template — HANYA berlaku utk voucher yang digenerate SETELAHNYA;
 * instance yang sudah beredar memegang snapshot aturan lama.
 */
export async function updateMembershipVoucher(
  input: z.infer<typeof updateTemplateSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const data = updateTemplateSchema.parse(input);
  const err = validateTemplateFields(data);
  if (err) return { ok: false, error: err };

  await db
    .update(membershipVouchers)
    .set({
      name: data.name,
      discountType: data.discountType,
      discountValue: data.discountValue,
      maxDiscount: data.maxDiscount,
      minSpend: data.minSpend,
      levelKey: data.levelKey,
      validDays: data.validDays,
      isActive: data.isActive,
    })
    .where(eq(membershipVouchers.id, data.id));

  revalidatePath("/admin/membership/vouchers");
  return { ok: true };
}

/** Hapus PERMANEN — hanya kalau belum pernah generate instance. */
export async function deleteMembershipVoucher(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const templateId = z.string().uuid().parse(id);

  if (await templateHasInstances(templateId)) {
    return {
      ok: false,
      error:
        "Members already received vouchers from this template — deactivate it instead of deleting",
    };
  }
  await db
    .delete(membershipVouchers)
    .where(eq(membershipVouchers.id, templateId));

  revalidatePath("/admin/membership/vouchers");
  return { ok: true };
}

export interface AdminVoucherRow {
  id: string;
  name: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  max_discount: number | null;
  min_spend: number | null;
  level_key: string | null;
  valid_days: number;
  is_active: boolean;
  /** Jumlah instance yang pernah digenerate ke member. */
  generated_count: number;
  created_at: string;
}

export async function listMembershipVouchers(): Promise<AdminVoucherRow[]> {
  await requireAdmin();
  const rows = await db
    .select()
    .from(membershipVouchers)
    .orderBy(desc(membershipVouchers.createdAt));
  const counts = await getGeneratedCounts(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    discount_type: r.discountType,
    discount_value: r.discountValue,
    max_discount: r.maxDiscount,
    min_spend: r.minSpend,
    level_key: r.levelKey,
    valid_days: r.validDays,
    is_active: r.isActive,
    generated_count: counts.get(r.id) ?? 0,
    created_at: r.createdAt.toISOString(),
  }));
}

// ============================================================
// TRANSAKSI — list admin (M9)
// ============================================================

export interface AdminMembershipTxRow {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  level_key: string;
  level_name: string;
  kind: "purchase" | "renewal" | "admin_grant";
  base_amount: number;
  tax_amount: number;
  service_amount: number;
  amount: number;
  period_start: string;
  period_end: string | null;
  status: "pending" | "paid" | "failed" | "refunded";
  paid_at: string | null;
  created_at: string;
}

const TX_PAGE_SIZE = 25;

export async function listMembershipTransactions(opts?: {
  status?: "pending" | "paid" | "failed" | "refunded";
  page?: number;
}): Promise<{ rows: AdminMembershipTxRow[]; total: number }> {
  await requireAdmin();
  const page = Math.max(1, opts?.page ?? 1);
  const where = opts?.status
    ? eq(membershipTransactions.status, opts.status)
    : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: membershipTransactions.id,
        customer_id: membershipTransactions.profileId,
        customer_name: profiles.displayName,
        customer_email: users.email,
        level_key: membershipTransactions.levelKey,
        level_name: membershipLevels.name,
        kind: membershipTransactions.kind,
        base_amount: membershipTransactions.baseAmount,
        tax_amount: membershipTransactions.taxAmount,
        service_amount: membershipTransactions.serviceAmount,
        amount: membershipTransactions.amount,
        period_start: membershipTransactions.periodStart,
        period_end: membershipTransactions.periodEnd,
        status: membershipTransactions.status,
        paid_at: membershipTransactions.paidAt,
        created_at: membershipTransactions.createdAt,
      })
      .from(membershipTransactions)
      .innerJoin(profiles, eq(profiles.id, membershipTransactions.profileId))
      .innerJoin(users, eq(users.id, membershipTransactions.profileId))
      .innerJoin(
        membershipLevels,
        eq(membershipLevels.key, membershipTransactions.levelKey)
      )
      .where(where)
      .orderBy(desc(membershipTransactions.createdAt))
      .limit(TX_PAGE_SIZE)
      .offset((page - 1) * TX_PAGE_SIZE),
    db
      .select({ total: count() })
      .from(membershipTransactions)
      .where(where),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      period_start: r.period_start.toISOString(),
      period_end: r.period_end?.toISOString() ?? null,
      paid_at: r.paid_at?.toISOString() ?? null,
      created_at: r.created_at.toISOString(),
    })),
    total: Number(totalRow[0]?.total ?? 0),
  };
}

// ============================================================
// UBAH LEVEL CUSTOMER — admin_grant (M8)
// ============================================================

const adminSetSchema = z.object({
  customerId: z.string().uuid(),
  levelKey: levelKeySchema,
  /** Bulan masa aktif; null = LIFETIME. Diabaikan utk basic. */
  durationMonths: z.number().int().min(1).max(120).nullable(),
});

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Admin mengubah level customer. Menimpa level & masa aktif berjalan
 * (aturan G5 — sisa masa hangus; UI menampilkan peringatan). SELALU
 * tercatat sebagai transaksi kind='admin_grant' amount 0 (audit).
 */
export async function adminSetMembership(
  input: z.infer<typeof adminSetSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const me = await getCurrentProfile();
  const data = adminSetSchema.parse(input);

  const [target] = await db
    .select({ id: profiles.id, isGuest: profiles.isGuest })
    .from(profiles)
    .where(eq(profiles.id, data.customerId))
    .limit(1);
  if (!target) return { ok: false, error: "Customer not found" };
  if (target.isGuest) {
    return { ok: false, error: "Guest accounts can't have a membership" };
  }

  const now = new Date();
  const isBasic = data.levelKey === "basic";
  const expiresAt = isBasic
    ? null
    : data.durationMonths == null
      ? null // lifetime
      : addMonths(now, data.durationMonths);

  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({
        membershipLevel: data.levelKey,
        membershipExpiresAt: expiresAt,
      })
      .where(eq(profiles.id, data.customerId));

    await tx.insert(membershipTransactions).values({
      profileId: data.customerId,
      levelKey: data.levelKey,
      kind: "admin_grant",
      baseAmount: 0,
      amount: 0,
      periodStart: now,
      periodEnd: expiresAt,
      status: "paid",
      method: "admin",
      grantedBy: me?.id ?? null,
      paidAt: now,
    });
  });

  // Grant ke level berbayar = aktivasi → member menerima voucher benefit
  // (rev-2), sama seperti pembelian.
  if (!isBasic) {
    await generateMemberVouchers({
      profileId: data.customerId,
      levelKey: data.levelKey,
      membershipTxId: null,
    });
  }

  revalidatePath(`/admin/users/${data.customerId}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin/membership/transactions");
  return { ok: true };
}

// ============================================================
// PEMBELIAN — sisi customer (Fase 3)
// ============================================================

function addPeriod(from: Date, period: "monthly" | "yearly"): Date {
  const d = new Date(from);
  if (period === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** Guard pembeli: login, bukan guest, bukan staff. */
async function requirePurchaser() {
  const me = await requireProfile();
  const [[guestRow], [staff]] = await Promise.all([
    db
      .select({ isGuest: profiles.isGuest })
      .from(profiles)
      .where(eq(profiles.id, me.id))
      .limit(1),
    db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(and(eq(staffRoles.profileId, me.id), eq(staffRoles.isActive, true)))
      .limit(1),
  ]);
  if (guestRow?.isGuest) throw new Error("Guest accounts can't buy a membership");
  if (staff) throw new Error("Staff accounts don't need a membership");
  return me;
}

export interface PurchasePreview {
  ok: boolean;
  error?: string;
  level_name?: string;
  /** Harga level (sebelum tax & service). */
  base_amount?: number;
  /** Snapshot tax & service dari ChargeConfig bar (config yg sama dgn bill F&B). */
  tax_amount?: number;
  service_amount?: number;
  /** Persen gabungan utk label "(15%)"; 0 = tanpa charge. */
  charge_percent?: number;
  /** Label charge sesuai komponen aktif. */
  charge_label?: string;
  /** Total ditagih = base + tax + service. */
  final_amount?: number;
  /** renewal = level sama & masih aktif → masa ditambahkan dari expiry lama. */
  kind?: "purchase" | "renewal";
  /** ISO; null = lifetime. */
  new_expires_at?: string | null;
  /** True kalau ini GANTI level saat masa aktif lain masih berjalan (G5). */
  replaces_active?: boolean;
}

/**
 * Hitung ringkasan harga + periode SEBELUM bayar (dipakai form beli, juga
 * dipanggil ulang oleh purchaseMembership — satu sumber perhitungan).
 * rev-2: tax & service dari ChargeConfig bar (computeBillTotals — sumber
 * kebenaran yang sama dgn bill F&B); voucher TIDAK ada di checkout.
 */
export async function previewMembershipPurchase(input: {
  levelKey: string;
}): Promise<PurchasePreview> {
  const me = await requirePurchaser();
  const levelKey = z.enum(["premium", "vip"]).safeParse(input.levelKey);
  if (!levelKey.success) return { ok: false, error: "Invalid plan" };

  const [level] = await db
    .select()
    .from(membershipLevels)
    .where(eq(membershipLevels.key, levelKey.data))
    .limit(1);
  if (!level || !level.isPurchasable)
    return { ok: false, error: "This plan isn't available right now" };

  const [meRow] = await db
    .select({
      level: profiles.membershipLevel,
      expiresAt: profiles.membershipExpiresAt,
    })
    .from(profiles)
    .where(eq(profiles.id, me.id))
    .limit(1);
  const effKey = effectiveLevelKey(meRow?.level, meRow?.expiresAt);

  // Level sama & lifetime → tak ada yang bisa dibeli lagi.
  if (effKey === level.key && meRow?.expiresAt == null) {
    return { ok: false, error: "You already have this plan for life" };
  }

  // Tax & service — ChargeConfig bar yang sama dgn bill F&B.
  const bar = await getBarBySlug(
    process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto"
  );
  const charge = bar ? await getChargeConfig(bar.id) : null;
  const bill = computeBillTotals(level.price, charge);

  // Periode (SNAPSHOT — aktivasi tinggal menerapkan, PRD 8):
  // - one_time → lifetime (end NULL);
  // - level sama & masih aktif → RENEWAL: end = expiry lama + periode (G6);
  // - selain itu → PURCHASE: end = now + periode (G5 — ganti langsung).
  const now = new Date();
  let kind: "purchase" | "renewal" = "purchase";
  let end: Date | null = null;
  if (level.billingPeriod !== "one_time") {
    let baseDate = now;
    if (effKey === level.key && meRow?.expiresAt && meRow.expiresAt > now) {
      kind = "renewal";
      baseDate = meRow.expiresAt;
    }
    end = addPeriod(baseDate, level.billingPeriod);
  }

  return {
    ok: true,
    level_name: level.name,
    base_amount: bill.subtotal,
    tax_amount: bill.tax,
    service_amount: bill.service,
    charge_percent: bill.chargePercent,
    charge_label: bill.chargeLabel,
    final_amount: bill.total,
    kind,
    new_expires_at: end?.toISOString() ?? null,
    replaces_active: effKey !== "basic" && effKey !== level.key,
  };
}

export type PurchaseResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** true = langsung aktif (mock gateway / total 0). */
      activated: boolean;
      txId: string;
      qrString: string | null;
      amount: number;
      /** Detik menuju QR kedaluwarsa (utk countdown), null kalau tak ada. */
      qrExpirySeconds: number | null;
    };

/**
 * Buat transaksi + charge QRIS. Satu pending per user — pending lama
 * ditandai failed dulu. Semua parameter di-SNAPSHOT ke baris transaksi
 * (base + tax + service + periode).
 */
export async function purchaseMembership(input: {
  levelKey: string;
}): Promise<PurchaseResult> {
  const me = await requirePurchaser();

  const preview = await previewMembershipPurchase(input);
  if (!preview.ok)
    return { ok: false, error: preview.error ?? "Can't purchase" };

  const levelKey = input.levelKey as MembershipKey;

  // Satu pending per user: matikan yang lama (tak pernah dua QR hidup).
  await db
    .update(membershipTransactions)
    .set({ status: "failed" })
    .where(
      and(
        eq(membershipTransactions.profileId, me.id),
        eq(membershipTransactions.status, "pending")
      )
    );

  const now = new Date();
  const [tx] = await db
    .insert(membershipTransactions)
    .values({
      profileId: me.id,
      levelKey,
      kind: preview.kind ?? "purchase",
      baseAmount: preview.base_amount ?? 0,
      taxAmount: preview.tax_amount ?? 0,
      serviceAmount: preview.service_amount ?? 0,
      amount: preview.final_amount ?? 0,
      periodStart: now,
      periodEnd: preview.new_expires_at
        ? new Date(preview.new_expires_at)
        : null,
      status: "pending",
      method: "qris",
    })
    .returning({ id: membershipTransactions.id });

  // Total 0 (level gratis + tanpa charge — edge) → aktivasi instan.
  if ((preview.final_amount ?? 0) <= 0) {
    await activateMembershipTx(tx.id);
    return {
      ok: true,
      activated: true,
      txId: tx.id,
      qrString: null,
      amount: 0,
      qrExpirySeconds: null,
    };
  }

  // Charge gateway (pola payShare).
  const gateway = getPaymentGateway();
  let charge;
  try {
    charge = await gateway.createCharge({
      paymentId: tx.id,
      amount: preview.final_amount!,
      method: "qris",
      payerName: me.displayName,
      description: `SOHO membership — ${preview.level_name}`,
    });
  } catch {
    await db
      .update(membershipTransactions)
      .set({ status: "failed" })
      .where(eq(membershipTransactions.id, tx.id));
    return { ok: false, error: "Payment gateway is unavailable. Try again." };
  }

  const qrExpiresAt = charge.expiresAt ? new Date(charge.expiresAt) : null;
  await db
    .update(membershipTransactions)
    .set({
      externalRef: charge.externalRef,
      qrString: charge.qrString ?? null,
      qrExpiresAt,
    })
    .where(eq(membershipTransactions.id, tx.id));

  // Mock gateway langsung paid → aktifkan sekarang.
  if (charge.status === "paid") {
    await activateMembershipTx(tx.id);
    return {
      ok: true,
      activated: true,
      txId: tx.id,
      qrString: null,
      amount: preview.final_amount!,
      qrExpirySeconds: null,
    };
  }

  return {
    ok: true,
    activated: false,
    txId: tx.id,
    qrString: charge.qrString ?? null,
    amount: preview.final_amount!,
    qrExpirySeconds: qrExpiresAt
      ? Math.max(30, Math.floor((qrExpiresAt.getTime() - Date.now()) / 1000))
      : null,
  };
}

/**
 * Aktivasi transaksi — IDEMPOTENT via conditional update WHERE
 * status='pending' (polling & callback bisa datang bersamaan, PRD 8).
 * Terapkan SNAPSHOT (level + period_end) ke profil; lalu GENERATE voucher
 * benefit pribadi dari template aktif level tsb (rev-2) + notif pasca-commit.
 */
async function activateMembershipTx(txId: string): Promise<boolean> {
  let activated: {
    profileId: string;
    levelKey: string;
    periodEnd: Date | null;
  } | null = null;

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(membershipTransactions)
      .set({ status: "paid", paidAt: new Date() })
      .where(
        and(
          eq(membershipTransactions.id, txId),
          eq(membershipTransactions.status, "pending")
        )
      )
      .returning({
        profileId: membershipTransactions.profileId,
        levelKey: membershipTransactions.levelKey,
        periodEnd: membershipTransactions.periodEnd,
      });
    if (updated.length === 0) return; // sudah diproses request lain
    const row = updated[0];

    await tx
      .update(profiles)
      .set({
        membershipLevel: row.levelKey,
        membershipExpiresAt: row.periodEnd,
      })
      .where(eq(profiles.id, row.profileId));
    activated = row;
  });

  if (!activated) return false;
  const row = activated as {
    profileId: string;
    levelKey: string;
    periodEnd: Date | null;
  };

  // Bagi hasil service fee membership (G7; best-effort).
  await settleRevenueSplitForMembershipTx(txId).catch((e) =>
    console.error("[split] membership:", e)
  );

  // Post-commit: generate voucher benefit (idempotensi dijamin oleh guard
  // conditional di atas — hanya SATU pemanggil yang sampai sini per tx).
  const voucherCount = await generateMemberVouchers({
    profileId: row.profileId,
    levelKey: row.levelKey,
    membershipTxId: txId,
  });

  const [level] = await db
    .select({ name: membershipLevels.name })
    .from(membershipLevels)
    .where(eq(membershipLevels.key, row.levelKey))
    .limit(1);
  await createNotification({
    profileId: row.profileId,
    type: "general",
    title: `${level?.name ?? "Membership"} activated`,
    body:
      (row.periodEnd
        ? `Your membership is active until ${row.periodEnd.toLocaleDateString("en-US", { dateStyle: "long" })}.`
        : "Your membership is active for life.") +
      (voucherCount > 0
        ? ` You received ${voucherCount} voucher${voucherCount === 1 ? "" : "s"} — check the Vouchers tab.`
        : ""),
    link: "/membership",
  });
  revalidatePath("/membership");
  revalidatePath("/profile");
  revalidatePath("/admin/membership/transactions");
  return true;
}

/**
 * Polling status pembayaran membership (dipakai QrisPaymentDialog).
 * paid → aktivasi idempotent; failed → tandai supaya QR mati tak tampil lagi.
 */
export async function checkMembershipPaymentStatus(
  txId: string
): Promise<{ status: string }> {
  const me = await requireProfile();
  const id = z.string().uuid().parse(txId);

  const [row] = await db
    .select({
      id: membershipTransactions.id,
      profileId: membershipTransactions.profileId,
      status: membershipTransactions.status,
      externalRef: membershipTransactions.externalRef,
    })
    .from(membershipTransactions)
    .where(eq(membershipTransactions.id, id))
    .limit(1);
  if (!row || row.profileId !== me.id)
    throw new Error("Transaction not found");
  if (row.status !== "pending") return { status: row.status };
  if (!row.externalRef) return { status: "pending" };

  const gwStatus = await getPaymentGateway().checkStatus(row.externalRef);
  if (gwStatus === "paid") {
    await activateMembershipTx(row.id);
    return { status: "paid" };
  }
  if (gwStatus === "failed") {
    await db
      .update(membershipTransactions)
      .set({ status: "failed" })
      .where(
        and(
          eq(membershipTransactions.id, row.id),
          eq(membershipTransactions.status, "pending")
        )
      );
    return { status: "failed" };
  }
  return { status: gwStatus };
}

/** Batalkan transaksi pending sendiri (tombol di dialog QR). Idempotent. */
export async function cancelMembershipPayment(
  txId: string
): Promise<{ status: string }> {
  const me = await requireProfile();
  const id = z.string().uuid().parse(txId);

  const updated = await db
    .update(membershipTransactions)
    .set({ status: "failed" })
    .where(
      and(
        eq(membershipTransactions.id, id),
        eq(membershipTransactions.profileId, me.id),
        eq(membershipTransactions.status, "pending")
      )
    )
    .returning({ id: membershipTransactions.id });
  revalidatePath("/membership");
  return { status: updated.length > 0 ? "failed" : "unchanged" };
}

// ============================================================
// BACA — sisi customer
// ============================================================

export interface MyMembershipTxRow {
  id: string;
  level_name: string;
  kind: "purchase" | "renewal" | "admin_grant";
  base_amount: number;
  tax_amount: number;
  service_amount: number;
  amount: number;
  period_end: string | null;
  status: "pending" | "paid" | "failed" | "refunded";
  created_at: string;
}

export async function getMyMembershipTransactions(): Promise<
  MyMembershipTxRow[]
> {
  const me = await requireProfile();
  const rows = await db
    .select({
      id: membershipTransactions.id,
      level_name: membershipLevels.name,
      kind: membershipTransactions.kind,
      base_amount: membershipTransactions.baseAmount,
      tax_amount: membershipTransactions.taxAmount,
      service_amount: membershipTransactions.serviceAmount,
      amount: membershipTransactions.amount,
      period_end: membershipTransactions.periodEnd,
      status: membershipTransactions.status,
      created_at: membershipTransactions.createdAt,
    })
    .from(membershipTransactions)
    .innerJoin(
      membershipLevels,
      eq(membershipLevels.key, membershipTransactions.levelKey)
    )
    .where(eq(membershipTransactions.profileId, me.id))
    .orderBy(desc(membershipTransactions.createdAt))
    .limit(50);
  return rows.map((r) => ({
    ...r,
    period_end: r.period_end?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
  }));
}

export interface PendingMembershipTx {
  id: string;
  level_name: string;
  amount: number;
  qr_string: string | null;
  /** Detik tersisa; null kalau gateway tak memberi batas. */
  qr_expiry_seconds: number | null;
}

/** Transaksi pending milik sendiri (utk "Continue payment" saat kembali). */
export async function getMyPendingMembershipTx(): Promise<PendingMembershipTx | null> {
  const me = await requireProfile();
  const [row] = await db
    .select({
      id: membershipTransactions.id,
      level_name: membershipLevels.name,
      amount: membershipTransactions.amount,
      qr_string: membershipTransactions.qrString,
      qr_expires_at: membershipTransactions.qrExpiresAt,
    })
    .from(membershipTransactions)
    .innerJoin(
      membershipLevels,
      eq(membershipLevels.key, membershipTransactions.levelKey)
    )
    .where(
      and(
        eq(membershipTransactions.profileId, me.id),
        eq(membershipTransactions.status, "pending")
      )
    )
    .orderBy(desc(membershipTransactions.createdAt))
    .limit(1);
  if (!row) return null;
  // QR sudah kedaluwarsa → tandai failed sekalian (lazy, pola expireDp).
  if (row.qr_expires_at && row.qr_expires_at.getTime() < Date.now()) {
    await db
      .update(membershipTransactions)
      .set({ status: "failed" })
      .where(
        and(
          eq(membershipTransactions.id, row.id),
          eq(membershipTransactions.status, "pending")
        )
      );
    return null;
  }
  return {
    id: row.id,
    level_name: row.level_name,
    amount: row.amount,
    qr_string: row.qr_string,
    qr_expiry_seconds: row.qr_expires_at
      ? Math.max(1, Math.floor((row.qr_expires_at.getTime() - Date.now()) / 1000))
      : null,
  };
}

/** Voucher benefit milik user sendiri (tab Vouchers di /membership). */
export async function getMyVouchers(): Promise<MyVoucherRow[]> {
  const me = await requireProfile();
  return getVouchersOf(me.id);
}

/**
 * Preview potongan voucher utk pembayaran BILL (dipanggil UI sebelum bayar;
 * payShare/cashierCreatePayment memvalidasi ULANG server-side saat eksekusi).
 */
export async function previewBillVoucher(input: {
  code: string;
  sessionId: string;
  amount: number;
}): Promise<
  | { ok: true; code: string; name: string; discount: number }
  | { ok: false; error: string }
> {
  await requireProfile();
  const parsed = z
    .object({
      code: z.string().trim().min(3).max(20),
      sessionId: z.string().uuid(),
      amount: z.number().int().positive(),
    })
    .parse(input);
  const res = await resolveVoucherForBillPayment(parsed);
  if (!res.ok) return res;
  return {
    ok: true,
    code: res.voucher.code,
    name: res.voucher.name,
    discount: res.voucher.discount,
  };
}

// ============================================================
// FASE 5 — statistik & pengingat
// ============================================================

export interface MembershipStats {
  /** Jumlah member per level EFEKTIF (kedaluwarsa dihitung basic). */
  counts: Record<MembershipKey, number>;
  /** Pendapatan membership PAID 30 hari terakhir (IDR). */
  revenue_30d: number;
}

/** Statistik ringkas utk overview admin (member per level + revenue 30 hari). */
export async function getMembershipStats(): Promise<MembershipStats> {
  await requireAdmin();
  const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);
  const rows = await db
    .select({
      level: profiles.membershipLevel,
      expiresAt: profiles.membershipExpiresAt,
    })
    .from(profiles)
    .where(
      and(
        eq(profiles.isGuest, false),
        sql`${profiles.id} NOT IN (${staffIds})`
      )
    );
  const counts: Record<MembershipKey, number> = { basic: 0, premium: 0, vip: 0 };
  for (const r of rows) counts[effectiveLevelKey(r.level, r.expiresAt)]++;

  const [rev] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${membershipTransactions.amount}), 0)::int`,
    })
    .from(membershipTransactions)
    .where(
      and(
        eq(membershipTransactions.status, "paid"),
        sql`${membershipTransactions.paidAt} > now() - interval '30 days'`
      )
    );
  return { counts, revenue_30d: Number(rev?.total ?? 0) };
}

/**
 * Pengingat kedaluwarsa H-3 (Fase 5) — LAZY, dipicu kunjungan home (dipanggil
 * MembershipBanner; tanpa cron). Dedup: skip kalau pengingat serupa sudah
 * terkirim dalam 4 hari terakhir. Aman dipanggil berulang; hanya utk diri
 * sendiri (client memanggil pun cuma menspam dirinya — tetap ter-dedup).
 */
export async function maybeSendExpiryReminder(): Promise<void> {
  const me = await getCurrentProfile();
  if (!me) return;
  const [row] = await db
    .select({
      level: profiles.membershipLevel,
      expiresAt: profiles.membershipExpiresAt,
    })
    .from(profiles)
    .where(eq(profiles.id, me.id))
    .limit(1);
  if (!row?.expiresAt || row.level === "basic") return;
  const msLeft = row.expiresAt.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  if (msLeft <= 0 || daysLeft > 3) return;

  // Dedup: sudah ada pengingat dalam 4 hari terakhir?
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.profileId, me.id),
        eq(notifications.link, "/membership"),
        sql`${notifications.title} LIKE '%expires%'`,
        sql`${notifications.createdAt} > now() - interval '4 days'`
      )
    )
    .limit(1);
  if (existing) return;

  const [level] = await db
    .select({ name: membershipLevels.name })
    .from(membershipLevels)
    .where(eq(membershipLevels.key, row.level))
    .limit(1);
  await createNotification({
    profileId: me.id,
    type: "general",
    title: `Your ${level?.name ?? "membership"} expires in ${daysLeft <= 1 ? "1 day" : `${daysLeft} days`}`,
    body: "Renew now — time is added to your current period, nothing is lost.",
    link: "/membership",
  });
}

/**
 * Preview voucher milik SENDIRI utk DP saat buka meja (sesi belum ada —
 * kepemilikan = profil sendiri). openTable memvalidasi ulang server-side.
 */
export async function previewMyVoucher(input: {
  code: string;
  amount: number;
}): Promise<
  | { ok: true; code: string; name: string; discount: number }
  | { ok: false; error: string }
> {
  const me = await requireProfile();
  const parsed = z
    .object({
      code: z.string().trim().min(3).max(20),
      amount: z.number().int().positive(),
    })
    .parse(input);
  const res = await resolveVoucherForBillPayment({
    code: parsed.code,
    amount: parsed.amount,
    ownerId: me.id,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    code: res.voucher.code,
    name: res.voucher.name,
    discount: res.voucher.discount,
  };
}
