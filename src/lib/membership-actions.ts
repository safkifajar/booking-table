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
import { requireAdmin } from "@/lib/admin";
import { getCurrentProfile, requireProfile } from "@/lib/auth-v2/current";
import { getPaymentGateway } from "@/lib/payments/gateway";
import { createNotification } from "@/lib/notifications";
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
// VOUCHER — CRUD (M7)
// ============================================================

const voucherFieldsSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/, "Code: 3-32 chars, A-Z 0-9 _ -"),
  discountType: z.enum(["percent", "fixed"]),
  discountValue: z.number().int().min(1),
  /** null = berlaku semua level purchasable. */
  levelKey: z.enum(["premium", "vip"]).nullable(),
  maxUses: z.number().int().min(1).nullable(),
  perUserLimit: z.number().int().min(1).max(100),
  validFrom: z.string().datetime().nullable(),
  validUntil: z.string().datetime().nullable(),
  isActive: z.boolean(),
});

function validateVoucherFields(
  data: z.infer<typeof voucherFieldsSchema>
): string | null {
  if (data.discountType === "percent" && data.discountValue > 100) {
    return "Percent discount can't exceed 100";
  }
  if (
    data.validFrom &&
    data.validUntil &&
    new Date(data.validFrom) >= new Date(data.validUntil)
  ) {
    return "Valid-from must be before valid-until";
  }
  return null;
}

export async function createMembershipVoucher(
  input: z.infer<typeof voucherFieldsSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const data = voucherFieldsSchema.parse(input);
  const err = validateVoucherFields(data);
  if (err) return { ok: false, error: err };

  const inserted = await db
    .insert(membershipVouchers)
    .values({
      code: data.code,
      discountType: data.discountType,
      discountValue: data.discountValue,
      levelKey: data.levelKey,
      maxUses: data.maxUses,
      perUserLimit: data.perUserLimit,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
      isActive: data.isActive,
    })
    .onConflictDoNothing({ target: membershipVouchers.code })
    .returning({ id: membershipVouchers.id });
  if (inserted.length === 0) {
    return { ok: false, error: `Voucher code ${data.code} already exists` };
  }

  revalidatePath("/admin/membership/vouchers");
  return { ok: true };
}

const updateVoucherSchema = voucherFieldsSchema.extend({
  id: z.string().uuid(),
});

export async function updateMembershipVoucher(
  input: z.infer<typeof updateVoucherSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const data = updateVoucherSchema.parse(input);
  const err = validateVoucherFields(data);
  if (err) return { ok: false, error: err };

  // Code unik: cek bentrok dgn voucher LAIN.
  const [clash] = await db
    .select({ id: membershipVouchers.id })
    .from(membershipVouchers)
    .where(eq(membershipVouchers.code, data.code))
    .limit(1);
  if (clash && clash.id !== data.id) {
    return { ok: false, error: `Voucher code ${data.code} already exists` };
  }

  await db
    .update(membershipVouchers)
    .set({
      code: data.code,
      discountType: data.discountType,
      discountValue: data.discountValue,
      levelKey: data.levelKey,
      maxUses: data.maxUses,
      perUserLimit: data.perUserLimit,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
      isActive: data.isActive,
    })
    .where(eq(membershipVouchers.id, data.id));

  revalidatePath("/admin/membership/vouchers");
  return { ok: true };
}

/** Hapus PERMANEN — hanya selama belum pernah dipakai (riwayat aman). */
export async function deleteMembershipVoucher(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const voucherId = z.string().uuid().parse(id);

  const deleted = await db
    .delete(membershipVouchers)
    .where(
      and(
        eq(membershipVouchers.id, voucherId),
        eq(membershipVouchers.usedCount, 0)
      )
    )
    .returning({ id: membershipVouchers.id });
  if (deleted.length === 0) {
    return {
      ok: false,
      error: "Voucher has been used — deactivate it instead of deleting",
    };
  }

  revalidatePath("/admin/membership/vouchers");
  return { ok: true };
}

export interface AdminVoucherRow {
  id: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  level_key: string | null;
  max_uses: number | null;
  used_count: number;
  per_user_limit: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

export async function listMembershipVouchers(): Promise<AdminVoucherRow[]> {
  await requireAdmin();
  const rows = await db
    .select()
    .from(membershipVouchers)
    .orderBy(desc(membershipVouchers.createdAt));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    discount_type: r.discountType,
    discount_value: r.discountValue,
    level_key: r.levelKey,
    max_uses: r.maxUses,
    used_count: r.usedCount,
    per_user_limit: r.perUserLimit,
    valid_from: r.validFrom?.toISOString() ?? null,
    valid_until: r.validUntil?.toISOString() ?? null,
    is_active: r.isActive,
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
  amount: number;
  voucher_code: string | null;
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
        amount: membershipTransactions.amount,
        voucher_code: membershipVouchers.code,
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
      .leftJoin(
        membershipVouchers,
        eq(membershipVouchers.id, membershipTransactions.voucherId)
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

interface ResolvedVoucher {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
}

/**
 * Validasi voucher untuk checkout. Return error message (bukan throw) —
 * ini penolakan yang DIHARAPKAN; production menyensor pesan thrown.
 */
async function resolveVoucher(
  codeRaw: string,
  levelKey: MembershipKey,
  profileId: string
): Promise<{ voucher: ResolvedVoucher | null; error: string | null }> {
  const code = codeRaw.trim().toUpperCase();
  if (!code) return { voucher: null, error: null };

  const [v] = await db
    .select()
    .from(membershipVouchers)
    .where(eq(membershipVouchers.code, code))
    .limit(1);
  // Pesan sengaja SAMA untuk tidak-ada/nonaktif/di-luar-jendela — jangan
  // membocorkan kode mana yang eksis.
  const generic = "This voucher code isn't valid";
  const now = Date.now();
  if (!v || !v.isActive) return { voucher: null, error: generic };
  if (v.validFrom && v.validFrom.getTime() > now)
    return { voucher: null, error: generic };
  if (v.validUntil && v.validUntil.getTime() < now)
    return { voucher: null, error: generic };
  if (v.levelKey && v.levelKey !== levelKey)
    return { voucher: null, error: "This voucher doesn't apply to this plan" };
  if (v.maxUses != null && v.usedCount >= v.maxUses)
    return { voucher: null, error: "This voucher has been fully redeemed" };

  // Limit per user — hitung pemakaian TERBAYAR + yang masih pending.
  const [{ used }] = await db
    .select({ used: count() })
    .from(membershipTransactions)
    .where(
      and(
        eq(membershipTransactions.profileId, profileId),
        eq(membershipTransactions.voucherId, v.id),
        inArray(membershipTransactions.status, ["pending", "paid"])
      )
    );
  if (Number(used) >= v.perUserLimit)
    return { voucher: null, error: "You've already used this voucher" };

  return {
    voucher: {
      id: v.id,
      code: v.code,
      discountType: v.discountType,
      discountValue: v.discountValue,
    },
    error: null,
  };
}

function computeDiscount(base: number, v: ResolvedVoucher): number {
  const raw =
    v.discountType === "percent"
      ? Math.floor((base * v.discountValue) / 100)
      : v.discountValue;
  return Math.min(base, Math.max(0, raw)); // clamp — final tak pernah < 0 (PRD 8)
}

export interface PurchasePreview {
  ok: boolean;
  error?: string;
  level_name?: string;
  base_amount?: number;
  discount?: number;
  final_amount?: number;
  voucher_code?: string | null;
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
 */
export async function previewMembershipPurchase(input: {
  levelKey: string;
  voucherCode?: string;
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

  // Voucher (opsional).
  let voucher: ResolvedVoucher | null = null;
  if (input.voucherCode?.trim()) {
    const res = await resolveVoucher(
      input.voucherCode,
      level.key as MembershipKey,
      me.id
    );
    if (res.error) return { ok: false, error: res.error };
    voucher = res.voucher;
  }

  const base = level.price;
  const discount = voucher ? computeDiscount(base, voucher) : 0;
  const final = base - discount;

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
    base_amount: base,
    discount,
    final_amount: final,
    voucher_code: voucher?.code ?? null,
    kind,
    new_expires_at: end?.toISOString() ?? null,
    replaces_active: effKey !== "basic" && effKey !== level.key,
  };
}

export type PurchaseResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** true = langsung aktif (gratis via voucher / mock gateway). */
      activated: boolean;
      txId: string;
      qrString: string | null;
      amount: number;
      /** Detik menuju QR kedaluwarsa (utk countdown), null kalau tak ada. */
      qrExpirySeconds: number | null;
    };

/**
 * Buat transaksi + charge QRIS. Satu pending per user — pending lama
 * ditandai failed dulu. Semua parameter di-SNAPSHOT ke baris transaksi.
 */
export async function purchaseMembership(input: {
  levelKey: string;
  voucherCode?: string;
}): Promise<PurchaseResult> {
  const me = await requirePurchaser();

  const preview = await previewMembershipPurchase(input);
  if (!preview.ok)
    return { ok: false, error: preview.error ?? "Can't purchase" };

  const levelKey = input.levelKey as MembershipKey;
  // Ambil ulang id voucher (preview hanya bawa code).
  let voucherId: string | null = null;
  if (preview.voucher_code) {
    const [v] = await db
      .select({ id: membershipVouchers.id })
      .from(membershipVouchers)
      .where(eq(membershipVouchers.code, preview.voucher_code))
      .limit(1);
    voucherId = v?.id ?? null;
  }

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
      amount: preview.final_amount ?? 0,
      voucherId,
      periodStart: now,
      periodEnd: preview.new_expires_at
        ? new Date(preview.new_expires_at)
        : null,
      status: "pending",
      method: "qris",
    })
    .returning({ id: membershipTransactions.id });

  // Gratis total (voucher 100%) → aktivasi instan tanpa gateway (PRD 8).
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
 * Terapkan SNAPSHOT (level + period_end) ke profil; voucher used_count
 * naik di sini (bukan saat QR dibuat).
 */
async function activateMembershipTx(txId: string): Promise<boolean> {
  let activated: {
    profileId: string;
    levelKey: string;
    periodEnd: Date | null;
    voucherId: string | null;
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
        voucherId: membershipTransactions.voucherId,
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

    if (row.voucherId) {
      // Increment TANPA syarat kuota: uang sudah pindah — overshoot kuota
      // saat race adalah trade-off yang diterima (validasi kuota terjadi
      // saat QR dibuat; PRD 8).
      await tx
        .update(membershipVouchers)
        .set({ usedCount: sql`${membershipVouchers.usedCount} + 1` })
        .where(eq(membershipVouchers.id, row.voucherId));
    }
    activated = row;
  });

  if (!activated) return false;
  const row = activated as {
    profileId: string;
    levelKey: string;
    periodEnd: Date | null;
  };

  // Post-commit: notif + revalidasi (jangan di dalam transaksi).
  const [level] = await db
    .select({ name: membershipLevels.name })
    .from(membershipLevels)
    .where(eq(membershipLevels.key, row.levelKey))
    .limit(1);
  await createNotification({
    profileId: row.profileId,
    type: "general",
    title: `${level?.name ?? "Membership"} activated`,
    body: row.periodEnd
      ? `Your membership is active until ${row.periodEnd.toLocaleDateString("en-US", { dateStyle: "long" })}.`
      : "Your membership is active for life.",
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
  amount: number;
  voucher_code: string | null;
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
      amount: membershipTransactions.amount,
      voucher_code: membershipVouchers.code,
      period_end: membershipTransactions.periodEnd,
      status: membershipTransactions.status,
      created_at: membershipTransactions.createdAt,
    })
    .from(membershipTransactions)
    .innerJoin(
      membershipLevels,
      eq(membershipLevels.key, membershipTransactions.levelKey)
    )
    .leftJoin(
      membershipVouchers,
      eq(membershipVouchers.id, membershipTransactions.voucherId)
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
