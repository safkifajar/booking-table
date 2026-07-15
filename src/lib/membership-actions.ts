"use server";

/**
 * Server Actions — Membership, sisi ADMIN (PRD Membership Fase 2).
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
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  membershipLevels,
  membershipVouchers,
} from "@/lib/db/schema/membership";
import { membershipTransactions } from "@/lib/db/schema/membership-transactions";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { requireAdmin } from "@/lib/admin";
import { getCurrentProfile } from "@/lib/auth-v2/current";

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
