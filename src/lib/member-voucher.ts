import "server-only";

/**
 * Helper terpusat voucher member (PRD Membership rev-2) — generate, resolve,
 * reserve, settle, release.
 *
 * SENGAJA server-only lib, BUKAN "use server": settle/release mencetak baris
 * payments & mengubah status voucher — kalau ter-export sebagai server action,
 * client bisa memanggilnya langsung (devtools) dan mencetak pembayaran palsu.
 * Pemanggil sah: payShare / checkPaymentStatus / cancelPayment /
 * cashierCreatePayment (actions.ts) & aktivasi membership (membership-actions).
 *
 * Siklus: RESERVED (used_payment_id terisi saat QR dibuat, potongan dikunci
 * di discount_applied) → USED (used_at saat payment PAID + baris payments
 * method='voucher' senilai potongan — outstanding bill tertutup benar) →
 * atau DILEPAS (release) saat payment gagal/dibatalkan.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberVouchers } from "@/lib/db/schema/membership-transactions";
import { membershipVouchers } from "@/lib/db/schema/membership";
import { payments } from "@/lib/db/schema/orders";
import { sessionMembers } from "@/lib/db/schema/sessions";

// ============================================================
// GENERATE — dipanggil saat aktivasi membership
// ============================================================

/** Kode unik human-friendly: SOHO-XXXX-XXXX (tanpa 0/O/1/I). */
function randomVoucherCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) =>
    Array.from(
      { length: n },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  return `SOHO-${pick(4)}-${pick(4)}`;
}

/**
 * Generate voucher pribadi dari semua TEMPLATE aktif yang cocok dgn level
 * (level_key NULL = semua level purchasable). Satu instance per template per
 * aktivasi (keputusan user: tiap beli/perpanjang dapat set baru). Snapshot
 * aturan dari template. Retry kecil untuk tabrakan kode (unik global).
 */
export async function generateMemberVouchers(input: {
  profileId: string;
  levelKey: string;
  membershipTxId: string | null;
}): Promise<number> {
  if (input.levelKey === "basic") return 0;

  const templates = await db
    .select()
    .from(membershipVouchers)
    .where(
      and(
        eq(membershipVouchers.isActive, true),
        sql`(${membershipVouchers.levelKey} IS NULL OR ${membershipVouchers.levelKey} = ${input.levelKey})`
      )
    );
  if (templates.length === 0) return 0;

  let created = 0;
  for (const t of templates) {
    const expiresAt = new Date(Date.now() + t.validDays * 86_400_000);
    // Retry 3x kalau kode tabrakan (peluang sangat kecil, 32^8 ruang).
    for (let attempt = 0; attempt < 3; attempt++) {
      const inserted = await db
        .insert(memberVouchers)
        .values({
          templateId: t.id,
          profileId: input.profileId,
          code: randomVoucherCode(),
          name: t.name,
          discountType: t.discountType,
          discountValue: t.discountValue,
          maxDiscount: t.maxDiscount,
          minSpend: t.minSpend,
          membershipTxId: input.membershipTxId,
          expiresAt,
        })
        .onConflictDoNothing({ target: memberVouchers.code })
        .returning({ id: memberVouchers.id });
      if (inserted.length > 0) {
        created++;
        break;
      }
    }
  }
  return created;
}

// ============================================================
// RESOLVE + RESERVE — saat payment bill dibuat
// ============================================================

export interface ResolvedBillVoucher {
  voucherId: string;
  code: string;
  name: string;
  /** Potongan final utk amount ini (sudah di-clamp). */
  discount: number;
}

/**
 * Validasi kode voucher utk sebuah pembayaran bill. Pemilik voucher harus
 * member JOINED sesi tsb (host membayar / kasir menginput kode customer di
 * meja — dua-duanya sah selama pemiliknya duduk di meja itu). Return pesan
 * error (bukan throw) — penolakan yang diharapkan.
 */
export async function resolveVoucherForBillPayment(input: {
  code: string;
  sessionId: string;
  amount: number;
}): Promise<
  { ok: true; voucher: ResolvedBillVoucher } | { ok: false; error: string }
> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a voucher code" };

  const [v] = await db
    .select()
    .from(memberVouchers)
    .where(eq(memberVouchers.code, code))
    .limit(1);
  // Pesan generik yang sama utk tak-ada/terpakai/kedaluwarsa — tak
  // membocorkan kode mana yang eksis.
  const generic = "This voucher code isn't valid";
  if (!v) return { ok: false, error: generic };
  if (v.usedAt) return { ok: false, error: "This voucher has been used" };
  if (v.usedPaymentId) {
    return {
      ok: false,
      error: "This voucher is attached to another pending payment",
    };
  }
  if (v.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This voucher has expired" };
  }
  if (v.minSpend != null && input.amount < v.minSpend) {
    return {
      ok: false,
      error: `Minimum payment for this voucher is ${v.minSpend.toLocaleString("id-ID")}`,
    };
  }

  // Pemilik harus member JOINED di sesi ini (fisik di meja).
  const [member] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, input.sessionId),
        eq(sessionMembers.profileId, v.profileId),
        eq(sessionMembers.status, "joined")
      )
    )
    .limit(1);
  if (!member) {
    return {
      ok: false,
      error: "The voucher owner isn't a member of this table",
    };
  }

  const raw =
    v.discountType === "percent"
      ? Math.floor((input.amount * v.discountValue) / 100)
      : v.discountValue;
  const capped = v.maxDiscount != null ? Math.min(raw, v.maxDiscount) : raw;
  const discount = Math.min(Math.max(0, capped), input.amount);
  if (discount <= 0) return { ok: false, error: generic };

  return {
    ok: true,
    voucher: { voucherId: v.id, code: v.code, name: v.name, discount },
  };
}

/**
 * Reservasi voucher ke sebuah payment (race-safe conditional update).
 * false = kalah race (voucher keburu dipakai payment lain).
 */
export async function reserveVoucherForPayment(
  voucherId: string,
  paymentId: string,
  discount: number
): Promise<boolean> {
  const updated = await db
    .update(memberVouchers)
    .set({ usedPaymentId: paymentId, discountApplied: discount })
    .where(
      and(
        eq(memberVouchers.id, voucherId),
        isNull(memberVouchers.usedAt),
        isNull(memberVouchers.usedPaymentId)
      )
    )
    .returning({ id: memberVouchers.id });
  return updated.length > 0;
}

// ============================================================
// SETTLE / RELEASE — saat payment paid / gagal
// ============================================================

/**
 * Payment PAID → tandai voucher USED + cetak baris payments sintetis
 * method='voucher' senilai potongan (order & member sama dgn payment utama)
 * supaya outstanding bill tertutup benar. IDEMPOTENT: conditional update
 * used_at IS NULL — dipanggil dari beberapa jalur paid (mock instan,
 * polling, kasir) tanpa risiko dobel.
 */
export async function settleVoucherForPayment(
  paymentId: string,
  opts?: {
    /**
     * true = HANYA tandai used, tanpa mencetak baris payments diskon —
     * dipakai cabang full-discount di payShare yang baris voucher-nya
     * sudah dibuat manual (baris itu SENDIRI adalah pembayarannya).
     */
    skipSyntheticRow?: boolean;
  }
): Promise<void> {
  const settled = await db
    .update(memberVouchers)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(memberVouchers.usedPaymentId, paymentId),
        isNull(memberVouchers.usedAt)
      )
    )
    .returning({
      id: memberVouchers.id,
      code: memberVouchers.code,
      discount: memberVouchers.discountApplied,
    });
  if (settled.length === 0 || opts?.skipSyntheticRow) return;

  const [main] = await db
    .select({
      orderId: payments.orderId,
      paidByMemberId: payments.paidByMemberId,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!main) return; // payment hilang — voucher tetap used (audit manual)

  for (const v of settled) {
    if (!v.discount || v.discount <= 0) continue;
    await db.insert(payments).values({
      orderId: main.orderId,
      paidByMemberId: main.paidByMemberId,
      amount: v.discount,
      method: "voucher",
      status: "paid",
      splitMode: "custom",
      splitMeta: { voucherCode: v.code, voucherId: v.id, forPayment: paymentId },
      paidAt: new Date(),
    });
  }
}

/** Payment gagal/dibatalkan → lepas reservasi (voucher bisa dipakai lagi). */
export async function releaseVoucherForPayment(paymentId: string): Promise<void> {
  await db
    .update(memberVouchers)
    .set({ usedPaymentId: null, discountApplied: null })
    .where(
      and(
        eq(memberVouchers.usedPaymentId, paymentId),
        isNull(memberVouchers.usedAt)
      )
    );
}

// ============================================================
// BACA — voucher milik user & hitung instance per template (admin)
// ============================================================

export interface MyVoucherRow {
  id: string;
  code: string;
  name: string;
  discount_type: string;
  discount_value: number;
  max_discount: number | null;
  min_spend: number | null;
  expires_at: string;
  status: "active" | "reserved" | "used" | "expired";
}

export async function getVouchersOf(profileId: string): Promise<MyVoucherRow[]> {
  const rows = await db
    .select()
    .from(memberVouchers)
    .where(eq(memberVouchers.profileId, profileId))
    .orderBy(sql`${memberVouchers.usedAt} IS NOT NULL`, memberVouchers.expiresAt);
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    discount_type: r.discountType,
    discount_value: r.discountValue,
    max_discount: r.maxDiscount,
    min_spend: r.minSpend,
    expires_at: r.expiresAt.toISOString(),
    status: r.usedAt
      ? "used"
      : r.expiresAt.getTime() < now
        ? "expired"
        : r.usedPaymentId
          ? "reserved"
          : "active",
  }));
}

/** Jumlah instance yang pernah digenerate per template (utk admin list). */
export async function getGeneratedCounts(
  templateIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (templateIds.length === 0) return out;
  const rows = await db
    .select({
      templateId: memberVouchers.templateId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(memberVouchers)
    .where(inArray(memberVouchers.templateId, templateIds))
    .groupBy(memberVouchers.templateId);
  for (const r of rows) out.set(r.templateId, Number(r.n));
  return out;
}

/** Guard hapus template: hanya boleh kalau belum pernah generate instance. */
export async function templateHasInstances(templateId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memberVouchers.id })
    .from(memberVouchers)
    .where(eq(memberVouchers.templateId, templateId))
    .limit(1);
  return !!row;
}
