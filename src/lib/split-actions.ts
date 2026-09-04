"use server";

/**
 * Server Actions untuk SPLIT BATCH & siklus hidup satu pembayaran —
 * host membagi tagihan jadi 1 QRIS per anggota, lalu menerbitkan ulang,
 * memeriksa status, atau membatalkannya.
 *
 * Dipisah dari actions.ts sebagai bagian terakhir yang besar dari pemecahan
 * berkas 5.208 baris itu. Dikerjakan SETELAH payment-actions.ts karena blok
 * ini memanggil jalur pembayaran — memindahkan yang dipanggil lebih dulu
 * membuat batasnya jelas.
 *
 * Berkas ini bertanda "use server": Next.js melarangnya mengekspor apa pun
 * selain fungsi async, jadi skema Zod tak diekspor dan kedua tipe
 * kembaliannya tinggal di split-types.ts.
 */

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { menuItems } from "@/lib/db/schema/menu";
import {
  orders,
  orderItems,
  payments,
  paymentItems,
} from "@/lib/db/schema/orders";
import { staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { requireProfile } from "@/lib/auth-v2/current";
import { can } from "@/lib/auth-v2/permissions";
import {
  isSessionHost,
  assertHostOrActiveStaff,
  assertActiveStaffOfSession,
} from "@/lib/auth-v2/session-auth";
import { formatIDR } from "@/lib/utils";
import {
  notifySessionAndStaff,
  sendBookingInvites,
} from "@/lib/session-shared";
import { createNotification } from "@/lib/notifications";
import {
  settleOverdueIfPaid,
  getOrderOutstanding,
  settleOrderIfPaid,
  PAY_AT_CASHIER_TIMEOUT_SECONDS,
} from "@/lib/queries";
import {
  notifyPaymentEvent,
  notifyCashiersPayAtCashier,
  notifySplitMembers,
} from "@/lib/payment-notify";
import {
  settleVoucherForPayment,
  releaseVoucherForPayment,
} from "@/lib/member-voucher";
import { settleRevenueSplitForPayment } from "@/lib/revenue-split";
import { getPaymentGateway } from "@/lib/payments/gateway";
import { computeBillTotals } from "@/lib/settings-constants";
import { getChargeConfig } from "@/lib/settings-actions";
import type { PaymentStatus } from "@/types/db";
import type {
  SplitBatchMemberResult,
  SessionPaymentDetail,
} from "@/lib/split-types";

const splitBatchSchema = z.object({
  sessionId: z.string().uuid(),
  /** Multi-order: order spesifik yang di-split. Fallback ke order aktif sesi. */
  orderId: z.string().uuid().optional(),
  // Hanya 'equal'. Mode 'itemized' DIHAPUS: sejak hanya HOST yang boleh menambah
  // order, semua item ter-atribusi ke host → "item saya" = semua item (host) atau
  // kosong (anggota lain), jadi mode itu tak pernah masuk akal. Nilai "itemized"
  // tetap ada di enum DB utk data historis, tapi tak bisa dibuat lagi.
  mode: z.enum(["equal"]),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
});



/**
 * Host memicu SATU aksi split → sistem membuat 1 pembayaran + 1 QRIS untuk tiap
 * anggota (mode 'equal'). Tiap anggota nanti hanya melihat QRIS-nya sendiri.
 *
 * - Auth: HOST meja atau staff aktif di bar (jalur staff = sesi walk-in).
 * - equal: share = ceil(REMAINING / N) — dihitung dari SISA, bukan total. Ini
 *   penting saat ada DP: sisa-lah utang bersama yang dibagi. Anggota terakhir
 *   menyerap selisih pembulatan supaya Σ share == remaining (tak over/under).
 * - Anti-duplikat: anggota yang sudah punya payment pending belum-expired dilewati.
 * - Error per-anggota tak menggagalkan semua (best-effort per anggota).
 *
 * (PRD Host-Only Payment FR4-FR8.)
 */
export async function createSplitBatch(
  input: z.infer<typeof splitBatchSchema>
): Promise<{ batchId: string; results: SplitBatchMemberResult[] }> {
  const profile = await requireProfile();
  const data = splitBatchSchema.parse(input);

  // 1. Auth: host atau staff aktif di bar sesi.
  const { barId } = await assertHostOrActiveStaff(data.sessionId, profile.id);

  // 2. Order yang di-split. Multi-order: pakai orderId kalau diberi (dicek milik
  // sesi); else fallback ke order aktif terbaru.
  let order: { id: string; ownerMemberId: string | null } | undefined;
  if (data.orderId) {
    const [byId] = await db
      .select({ id: orders.id, ownerMemberId: orders.ownerMemberId })
      .from(orders)
      .where(and(eq(orders.id, data.orderId), eq(orders.sessionId, data.sessionId)));
    order = byId;
    if (!order) throw new Error("Order not found for this table");
  } else {
    // Fallback tanpa orderId → HARUS order MEJA. Order terbaru di sesi bisa
    // saja milik anggota; tanpa filter ini host membayar/menyplit order orang.
    const [openOrder] = await db
      .select({ id: orders.id, ownerMemberId: orders.ownerMemberId })
      .from(orders)
      .where(
        and(
          eq(orders.sessionId, data.sessionId),
          ne(orders.status, "closed"),
          ne(orders.status, "cancelled"),
          isNull(orders.ownerMemberId)
        )
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    order = openOrder;
  }
  if (!order) throw new Error("No open order for this session");

  // Order milik ANGGOTA tak boleh di-split — dia wajib membayarnya sendiri,
  // penuh. Tanpa penjagaan ini host bisa membagi pesanan pribadi anggota ke
  // seluruh meja, persis kebalikan dari aturan fitur ini.
  if (order.ownerMemberId) {
    throw new Error("A member's own order can't be split, they pay it in full");
  }

  // 3. Bill: subtotal (non-void) + charge → total; remaining = total − paid.
  const [subRow] = await db
    .select({
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
    })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), ne(orderItems.status, "void")));
  const charge = await getChargeConfig(barId);
  const bill = computeBillTotals(Number(subRow?.subtotal ?? 0), charge);
  // Remaining PER-ORDER (bukan sesi): total order − Σ(payment lunas order ini).
  const remaining = (await getOrderOutstanding(order.id)).outstanding;
  if (remaining <= 0) throw new Error("This order is already paid");

  // 4. Anggota joined + profil.
  const joined = await db
    .select({
      memberId: sessionMembers.id,
      profileId: sessionMembers.profileId,
      displayName: profiles.displayName,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, data.sessionId),
        eq(sessionMembers.status, "joined")
      )
    );

  // 5. Anggota yang sudah punya payment pending belum-expired → skip (anti-dup).
  const now = Date.now();
  const existing = await db
    .select({
      memberId: payments.paidByMemberId,
      status: payments.status,
      splitMeta: payments.splitMeta,
    })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "pending")));
  const hasActivePending = new Set(
    existing
      .filter((p) => {
        const exp = (p.splitMeta as { expiresAt?: string | null } | null)
          ?.expiresAt;
        return !exp || new Date(exp).getTime() > now;
      })
      .map((p) => p.memberId)
  );

  // 6. Tentukan share per anggota — BAGI RATA DARI SISA (remaining).
  //    Basisnya `remaining`, BUKAN bill.total: kalau sudah ada DP lunas, yang
  //    dibagi adalah sisa utang bersama. (Dulu pakai bill.total → orang pertama
  //    menanggung seluruh sisa & sisanya kebagian 0. Itu bug.)
  //    Contoh: total 100rb, DP 50rb lunas, 2 anggota → masing-masing 25rb.
  type Target = { memberId: string; displayName: string; amount: number; itemIds: { id: string; amount: number }[] };
  const n = joined.length;
  if (n === 0) throw new Error("No members to split between");
  const per = Math.ceil(remaining / n);
  // Anggota terakhir menyerap selisih pembulatan → Σ share == remaining persis.
  let allocated = 0;
  const targets: Target[] = joined.map((m, i) => {
    const isLast = i === n - 1;
    let amount = isLast ? remaining - allocated : Math.min(per, remaining - allocated);
    amount = Math.max(0, amount);
    allocated += amount;
    return { memberId: m.memberId, displayName: m.displayName, amount, itemIds: [] };
  });

  // 7. Buat payment + QRIS per anggota (best-effort per anggota).
  const batchId = crypto.randomUUID();
  const gateway = getPaymentGateway();
  const results: SplitBatchMemberResult[] = [];

  for (const t of targets) {
    if (t.amount <= 0) {
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: 0, status: "skipped", qrString: null, expiresAt: null, externalRef: null, note: "Nothing to pay" });
      continue;
    }
    if (hasActivePending.has(t.memberId)) {
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: t.amount, status: "skipped", qrString: null, expiresAt: null, externalRef: null, note: "Already has a pending payment" });
      continue;
    }
    // Dideklarasikan DI LUAR try supaya blok catch bisa membuang barisnya.
    let pay: { id: string } | undefined;
    try {
      [pay] = await db
        .insert(payments)
        .values({
          orderId: order.id,
          paidByMemberId: t.memberId,
          amount: t.amount,
          method: data.method,
          status: "pending",
          splitMode: data.mode,
          splitMeta: { batchId },
          paidAt: null,
        })
        .returning({ id: payments.id });

      // Catatan: mode 'equal' tak menulis payment_items (tak ada tautan item).
      // Dulu ada cabang 'itemized' di sini — dihapus bersama mode-nya.

      // "Pay at cashier": tanpa gateway — tiap share pending sampai anggota
      // datang ke kasir & kasir konfirmasi satu-satu.
      if (data.method === "cash") {
        // Batas 10 mnt (sama dgn payShare cash) → sumber countdown + lazy-expire.
        const batchExpiresAt = new Date(
          Date.now() + PAY_AT_CASHIER_TIMEOUT_SECONDS * 1000
        ).toISOString();
        await db
          .update(payments)
          .set({
            externalRef: `cashier_${pay.id}`,
            splitMeta: { batchId, payAtCashier: true, expiresAt: batchExpiresAt },
          })
          .where(eq(payments.id, pay.id));
        results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: pay.id, amount: t.amount, status: "pending", qrString: null, expiresAt: batchExpiresAt, externalRef: null });
        continue;
      }

      const cr = await gateway.createCharge({
        paymentId: pay.id,
        amount: t.amount,
        method: data.method,
        payerName: t.displayName,
        description: `Split ${data.mode} - ${data.sessionId.slice(0, 8)}`,
      });

      await db
        .update(payments)
        .set({
          externalRef: cr.externalRef,
          status: cr.status,
          paidAt: cr.status === "paid" ? new Date() : null,
          splitMeta: {
            batchId,
            qrString: cr.qrString ?? null,
            redirectUrl: cr.redirectUrl ?? null,
            expiresAt: cr.expiresAt ?? null,
            merchantOrderId: cr.merchantOrderId ?? pay.id,
          },
        })
        .where(eq(payments.id, pay.id));

      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: pay.id, amount: t.amount, status: cr.status, qrString: cr.qrString ?? null, expiresAt: cr.expiresAt ?? null, externalRef: cr.externalRef ?? null });
    } catch (err) {
      console.error("[createSplitBatch] gagal utk member", t.memberId, err);
      // Buang baris pending-nya — lihat catatan di payShare: pending tanpa
      // expiresAt mengunci tagihan selamanya bagi anggota ini.
      if (pay?.id) {
        await db.delete(payments).where(eq(payments.id, pay.id)).catch(() => {});
      }
      results.push({ memberId: t.memberId, displayName: t.displayName, paymentId: null, amount: t.amount, status: "error", qrString: null, expiresAt: null, externalRef: null, note: "Gateway error" });
    }
  }

  // Prepaid hook: kalau order kini lunas (semua share paid) → order MASUK.
  await settleOrderIfPaid(order.id);
  // Kalau ada yang langsung paid (mock) & sesi overdue → settle.
  if (results.some((r) => r.status === "paid")) {
    await settleOverdueIfPaid(data.sessionId);
  }

  await notifySessionAndStaff(data.sessionId);

  // Kabari tiap ANGGOTA bahwa bagiannya siap dibayar. notifySessionAndStaff di
  // atas hanya menyegarkan layar lewat SSE — anggota yang tak sedang membuka
  // aplikasi tak tahu apa-apa. Host dilewati di dalam fungsinya (QRIS-nya
  // sudah terpampang di layarnya sendiri).
  await notifySplitMembers({
    sessionId: data.sessionId,
    orderId: order.id,
    members: results
      .filter((r) => r.paymentId && r.status === "pending")
      .map((r) => ({ memberId: r.memberId, amount: r.amount })),
  });

  // Split bayar-di-kasir: kabari kasir SEKALI (bukan per anggota) kalau ada
  // share pay-at-cashier yang pending.
  if (data.method === "cash") {
    const firstCashier = results.find(
      (r) => r.status === "pending" && r.paymentId
    );
    if (firstCashier?.paymentId) {
      await notifyCashiersPayAtCashier({
        paymentId: firstCashier.paymentId,
        isDownPayment: false,
      });
    }
  }
  revalidatePath(`/session/${data.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath(`/staff/cashier/${data.sessionId}`);

  return { batchId, results };
}

/**
 * Generate ULANG QRIS untuk SATU anggota yang pembayarannya gagal/kadaluarsa
 * (mis. telat bayar sampai QR mati). Dipicu host/staff dari tombol di baris
 * riwayat pembayaran anggota tsb.
 *
 * Efek: payment lama ditandai 'failed', dibuat payment BARU dgn nominal SAMA
 * (di-cap ke sisa tagihan) + QRIS baru, lalu notifikasi dikirim HANYA ke anggota
 * itu. Anggota membuka QRIS barunya lewat "Show QR" di riwayat (qr_string sudah
 * di-scope ke pemiliknya).
 *
 * GUARD:
 * - Auth: HOST meja atau staff aktif di bar.
 * - Payment lama harus milik order di sesi ini, dan statusnya 'failed' ATAU
 *   'pending' yang SUDAH lewat expiry. Pending yang MASIH aktif ditolak (cegah
 *   dua QRIS hidup sekaligus → risiko bayar dobel). 'paid' ditolak.
 * - Anti money-loss: sebelum mematikan payment lama, cek gateway — kalau
 *   ternyata sudah lunas, settle & tolak regenerate.
 */
export async function regenerateMemberPayment(input: {
  paymentId: string;
}): Promise<{
  paymentId: string;
  amount: number;
  status: PaymentStatus;
  qrString: string | null;
  expiresAt: string | null;
  /** Referensi gateway — layar QR menampilkannya alih-alih UUID internal. */
  externalRef: string | null;
}> {
  const profile = await requireProfile();

  // 1. Payment lama + konteks (order, sesi, anggota).
  const [old] = await db
    .select({
      id: payments.id,
      status: payments.status,
      amount: payments.amount,
      method: payments.method,
      splitMeta: payments.splitMeta,
      memberId: payments.paidByMemberId,
      orderId: payments.orderId,
      orderStatus: orders.status,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      payerProfileId: sessionMembers.profileId,
      payerName: profiles.displayName,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(eq(payments.id, input.paymentId));
  if (!old) throw new Error("Payment not found");

  // 2. Auth: host meja atau staff aktif di bar sesi (throw kalau bukan).
  await assertHostOrActiveStaff(old.sessionId, profile.id);

  // 3. Order & SESI harus masih hidup. (Sesi cancelled/closed: mejanya bisa
  //    sudah dilepas ke orang lain — jangan sampai terbit QRIS untuk booking
  //    yang tak ada lagi.)
  if (old.orderStatus === "closed" || old.orderStatus === "cancelled") {
    throw new Error("This order is already closed");
  }
  if (old.sessionStatus === "closed" || old.sessionStatus === "cancelled") {
    throw new Error("This table session is already closed");
  }
  if (old.status === "paid") throw new Error("This payment is already paid");

  // 4. DP booking punya lifecycle sendiri (flag isDownPayment → dp_paid_at,
  //    auto-cancel booking saat timeout). Regenerate akan menghilangkan flag itu
  //    & merusak status booking → tolak. DP yang mati harus lewat alur booking.
  const meta =
    (old.splitMeta as {
      expiresAt?: string | null;
      isDownPayment?: boolean;
    } | null) ?? {};
  if (meta.isDownPayment) {
    throw new Error(
      "Down payments can't be re-issued here. Please handle it from the booking."
    );
  }

  // 5. KUNCI ANTI DOUBLE-PAY: QRIS lama TETAP HIDUP di gateway meski kita tandai
  //    'failed' di DB — dan callback Duitku tetap akan menandainya 'paid'. Jadi
  //    kita HANYA boleh menerbitkan QRIS baru kalau GATEWAY SENDIRI memastikan
  //    yang lama sudah mati ('failed' = expired/cancel di Duitku).
  //    'pending' (termasuk saat kita gagal membaca respons gateway) = TOLAK:
  //    lebih baik pengguna menunggu daripada terbit dua QRIS hidup.
  //    Payment yang sudah 'failed' di DB tak perlu ditanya lagi ke gateway.
  const gateway = getPaymentGateway();
  if (old.status !== "failed") {
    let gw: Awaited<ReturnType<typeof gateway.checkStatus>>;
    try {
      gw = await gateway.checkStatus(old.id);
    } catch {
      throw new Error(
        "Couldn't verify the payment status. Please try again in a moment."
      );
    }
    if (gw === "paid") {
      // Ternyata sudah dibayar → settle, jangan buat QRIS baru.
      await db
        .update(payments)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(payments.id, old.id));
      await settleOrderIfPaid(old.orderId);
      await settleOverdueIfPaid(old.sessionId);
      await notifySessionAndStaff(old.sessionId);
      revalidatePath(`/session/${old.sessionId}`);
      throw new Error("That payment was actually paid. No new QRIS needed.");
    }
    if (gw !== "failed") {
      // Masih bisa dibayar di gateway → menerbitkan QRIS kedua = risiko bayar 2×.
      throw new Error(
        "The previous QRIS is still active at the payment provider. Please wait until it expires, then try again."
      );
    }
    // Gateway bilang mati → catat di DB supaya konsisten.
    await db
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(and(eq(payments.id, old.id), ne(payments.status, "paid")));
    await releaseVoucherForPayment(old.id);
  }

  // 6. Nominal: SAMA dgn payment lama, tapi di-cap ke sisa yang BENAR-BENAR
  //    belum tertutup = outstanding − Σ(payment pending yang masih hidup).
  //    Tanpa mengurangi pending, regenerate berulang bisa menerbitkan QRIS
  //    melebihi tagihan (mis. sebagian sudah dibayar tunai ke kasir) → overpay.
  const { outstanding } = await getOrderOutstanding(old.orderId);
  if (outstanding <= 0) throw new Error("This order is already fully paid");

  const pendingRows = await db
    .select({
      amount: payments.amount,
      splitMeta: payments.splitMeta,
      memberId: payments.paidByMemberId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, old.orderId),
        eq(payments.status, "pending"),
        ne(payments.id, old.id)
      )
    );
  const nowMs = Date.now();
  const isAlive = (meta: unknown) => {
    const m = (meta as { expiresAt?: string | null } | null) ?? {};
    const exp = m.expiresAt ? new Date(m.expiresAt).getTime() : null;
    // Tanpa expiry → anggap masih hidup (konservatif).
    return exp == null || exp > nowMs;
  };

  // Anggota ini sudah punya QRIS pengganti yang MASIH HIDUP → jangan terbitkan
  // lagi (kalau tidak, host bisa menumpuk QRIS ketiga, keempat, dst).
  if (
    pendingRows.some((p) => p.memberId === old.memberId && isAlive(p.splitMeta))
  ) {
    throw new Error(
      "A new QRIS was already issued for this member and is still active."
    );
  }

  const pendingLive = pendingRows.reduce(
    (sum, p) => (isAlive(p.splitMeta) ? sum + p.amount : sum),
    0
  );

  const room = Math.max(0, outstanding - pendingLive);
  const amount = Math.min(old.amount, room);
  if (amount <= 0) {
    throw new Error(
      "The remaining bill is already covered by other active payments."
    );
  }

  // 7. Buat payment + QRIS BARU DULU. Payment lama baru dimatikan SETELAH QRIS
  //    baru sukses terbit — kalau gateway gagal, tak ada yang berubah (payment
  //    lama tetap utuh, tak bikin anggota kehilangan riwayat/QRIS-nya).
  // batchId lama DIPERTAHANKAN supaya "cancel split" host tetap bisa mematikan
  // QRIS hasil regenerate ini (kalau dibuang, QRIS baru jadi tak punya
  // kill-switch & bisa terbayar setelah host mengira batch sudah dibatalkan).
  const batchId = (old.splitMeta as { batchId?: string | null } | null)?.batchId;
  const [pay] = await db
    .insert(payments)
    .values({
      orderId: old.orderId,
      paidByMemberId: old.memberId,
      amount,
      method: old.method,
      status: "pending",
      splitMode: "equal",
      splitMeta: { batchId: batchId ?? null, regeneratedFrom: old.id },
      paidAt: null,
    })
    .returning({ id: payments.id });

  let charge: Awaited<ReturnType<typeof gateway.createCharge>>;
  try {
    charge = await gateway.createCharge({
      paymentId: pay.id,
      amount,
      method: old.method,
      payerName: old.payerName,
      description: `Re-issued QRIS - ${old.sessionId.slice(0, 8)}`,
    });
  } catch {
    // Gateway gagal → buang payment kosong biar tak jadi sampah di riwayat.
    // Payment lama SENGAJA tak disentuh (belum sempat di-failed-kan).
    await db.delete(payments).where(eq(payments.id, pay.id));
    throw new Error("Failed to create the QRIS. Please try again.");
  }

  await db
    .update(payments)
    .set({
      externalRef: charge.externalRef,
      status: charge.status,
      paidAt: charge.status === "paid" ? new Date() : null,
      splitMeta: {
        batchId: batchId ?? null,
        regeneratedFrom: old.id,
        qrString: charge.qrString ?? null,
        redirectUrl: charge.redirectUrl ?? null,
        expiresAt: charge.expiresAt ?? null,
        merchantOrderId: charge.merchantOrderId ?? pay.id,
      },
    })
    .where(eq(payments.id, pay.id));

  // NB: payment lama sudah ditandai 'failed' di langkah 5 (setelah gateway
  // memastikan mati). Tak perlu diulang di sini.

  if (charge.status === "paid") {
    await settleOrderIfPaid(old.orderId);
    await settleOverdueIfPaid(old.sessionId);
  }

  // 8. Notifikasi HANYA ke anggota yang bersangkutan (bukan host/staff lain).
  await createNotification({
    profileId: old.payerProfileId,
    type: "general",
    title: "New QRIS ready for you",
    body: `Your previous QRIS expired. A new one for ${formatIDR(amount)} is ready. Tap to pay.`,
    link: `/session/${old.sessionId}/order/${old.orderId}`,
  });

  await notifySessionAndStaff(old.sessionId);
  revalidatePath(`/session/${old.sessionId}`);
  revalidatePath(`/session/${old.sessionId}/order/${old.orderId}`);
  revalidatePath("/staff/cashier");

  return {
    paymentId: pay.id,
    amount,
    status: charge.status,
    qrString: charge.qrString ?? null,
    expiresAt: charge.expiresAt ?? null,
    externalRef: charge.externalRef ?? null,
  };
}

/**
 * Batalkan seluruh split batch — set semua payment PENDING dalam batch tsb jadi
 * 'failed' (QR mati, tak lagi bisa dibayar). Payment yang sudah 'paid' TIDAK
 * tersentuh. Host-only (atau staff aktif di bar sesi).
 *
 * (PRD Host-Only Payment Q2.)
 */
export async function cancelSplitBatch(input: {
  sessionId: string;
  batchId: string;
}): Promise<{ cancelled: number }> {
  const profile = await requireProfile();
  const sessionId = z.string().uuid().parse(input.sessionId);
  const batchId = z.string().uuid().parse(input.batchId);

  // Auth: host atau staff aktif di bar sesi.
  await assertHostOrActiveStaff(sessionId, profile.id);

  // Batalkan payment pending dalam batch (match split_meta->>'batchId'),
  // dibatasi ke order sesi ini supaya batchId tak bocor lintas sesi.
  const result = await db
    .update(payments)
    .set({ status: "failed" })
    .where(
      and(
        eq(payments.status, "pending"),
        sql`${payments.splitMeta}->>'batchId' = ${batchId}`,
        sql`${payments.orderId} IN (SELECT ${orders.id} FROM ${orders} WHERE ${orders.sessionId} = ${sessionId})`
      )
    )
    .returning({ id: payments.id });

  // Lepas reservasi voucher yang menempel (kalau ada) — aman utk payment
  // tanpa voucher (no-op).
  for (const pRow of result) {
    await releaseVoucherForPayment(pRow.id);
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath(`/staff/cashier/${sessionId}`);

  return { cancelled: result.length };
}


/**
 * Detail satu transaksi pembayaran dalam sesi (untuk halaman detail transaksi).
 * Menampilkan list item + tax/service + QRIS.
 *
 * Akses: pemilik payment (member) ATAU host meja ATAU staff aktif di bar.
 * qr_string hanya diserahkan ke pemilik atau staff (bukan host lain / anggota lain).
 */
export async function getSessionPaymentDetail(
  sessionId: string,
  paymentId: string
): Promise<SessionPaymentDetail | null> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      splitMode: payments.splitMode,
      splitMeta: payments.splitMeta,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
      payerMemberId: payments.paidByMemberId,
      payerProfileId: sessionMembers.profileId,
      paidByName: profiles.displayName,
      barId: floorAreas.barId,
      hostId: tableSessions.hostId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(and(eq(payments.id, paymentId), eq(orders.sessionId, sessionId)));
  if (!row) return null;

  // Otorisasi + apakah pemanggil boleh lihat QR.
  const isOwner = row.payerProfileId === profile.id;
  const isHost = row.hostId === profile.id;
  let isStaff = false;
  if (!isOwner && !isHost) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, row.barId),
          eq(staffRoles.isActive, true)
        )
      );
    isStaff = !!staff;
  }
  // Harus salah satu: pemilik, host, atau staff (member lain boleh lihat detail
  // transaksi meja — read-only — tapi TANPA QR).
  const [isMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  if (!isOwner && !isHost && !isStaff && !isMember) {
    throw new Error("Not authorized to view this transaction");
  }

  // Item yang dicakup (itemized).
  const its = await db
    .select({
      amount: paymentItems.amount,
      quantity: orderItems.quantity,
      name: menuItems.name,
    })
    .from(paymentItems)
    .innerJoin(orderItems, eq(orderItems.id, paymentItems.orderItemId))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .where(eq(paymentItems.paymentId, paymentId));

  const meta =
    (row.splitMeta as {
      isDownPayment?: boolean;
      qrString?: string | null;
      expiresAt?: string | null;
      batchId?: string | null;
    } | null) ?? {};
  const itemsSubtotal = its.reduce((s, i) => s + i.amount, 0);
  const canSeeQr = isOwner || isStaff;

  // Ringkasan anggota bila transaksi ini bagian dari split batch.
  let batchMembers: { name: string; amount: number; status: string }[] = [];
  if (meta.batchId) {
    batchMembers = await db
      .select({
        name: profiles.displayName,
        amount: payments.amount,
        status: payments.status,
      })
      .from(payments)
      .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
      .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
      .where(sql`${payments.splitMeta}->>'batchId' = ${meta.batchId}`)
      .orderBy(payments.createdAt);
  }

  return {
    id: row.id,
    amount: row.amount,
    method: row.method,
    status: row.status,
    splitMode: row.splitMode,
    isDownPayment: !!meta.isDownPayment,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paidByName: row.paidByName,
    items: its.map((i) => ({ name: i.name, quantity: i.quantity, amount: i.amount })),
    itemsSubtotal,
    // Untuk itemized/treat: tax = amount − subtotal item. Untuk non-item (equal/DP)
    // tak ada rincian item → taxService 0 (amount ditampilkan apa adanya).
    taxService: itemsSubtotal > 0 ? Math.max(0, row.amount - itemsSubtotal) : 0,
    chargeLabel: (await import("@/lib/settings-constants")).computeBillTotals(
      0,
      await getChargeConfig(row.barId)
    ).chargeLabel,
    qrString: canSeeQr ? meta.qrString ?? null : null,
    expiresAt: meta.expiresAt ?? null,
    batchMembers,
  };
}

/**
 * Cek status pembayaran (member/staff sesi) — poll ke gateway (mis. QRIS
 * Duitku). Kalau lunas → tandai paid. Dipakai QR dialog customer/waiter.
 * Akses: pemanggil harus member joined ATAU staff aktif di bar sesi.
 */
export async function checkPaymentStatus(
  paymentId: string
): Promise<{ status: string }> {
  const profile = await requireProfile();

  // Payment + sesi + bar.
  const [row] = await db
    .select({
      id: payments.id,
      status: payments.status,
      splitMeta: payments.splitMeta,
      orderId: payments.orderId,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      dpPaidAt: tableSessions.dpPaidAt,
      barId: floorAreas.barId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(payments.id, paymentId));
  if (!row) throw new Error("Payment not found");
  if (row.status === "paid") return { status: "paid" };

  // Otorisasi: member joined sesi ATAU staff aktif di bar.
  const [asMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, row.sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  let allowed = !!asMember;
  if (!allowed) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, row.barId),
          eq(staffRoles.isActive, true)
        )
      );
    allowed = !!staff;
  }
  if (!allowed) throw new Error("Not allowed");

  const gateway = getPaymentGateway();
  const gwStatus = await gateway.checkStatus(row.id);
  if (gwStatus === "paid") {
    await db
      .update(payments)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(payments.id, row.id));
    // Voucher yang menempel → tandai used + cetak baris diskon (idempotent).
    await settleVoucherForPayment(row.id);
    await settleRevenueSplitForPayment(row.id).catch((e) =>
      console.error("[split] checkPaymentStatus:", e)
    );
    // DP booking lunas → tandai dp_paid_at (booking terkonfirmasi, tak jadi
    // dibatalkan oleh timeout).
    const meta = (row.splitMeta as { isDownPayment?: boolean } | null) ?? {};
    if (meta.isDownPayment) {
      // Guard transisi null→terisi (returning) → undangan hanya sekali. Booking
      // dgn undangan: user diundang baru dinotifikasi SETELAH DP lunas.
      const dpSet = await db
        .update(tableSessions)
        .set({ dpPaidAt: new Date() })
        .where(
          and(
            eq(tableSessions.id, row.sessionId),
            isNull(tableSessions.dpPaidAt)
          )
        )
        .returning({ id: tableSessions.id });
      if (dpSet.length > 0) {
        await sendBookingInvites(row.sessionId).catch((e) =>
          console.error("[invite] checkPaymentStatus:", e)
        );
      }
    }
    // Prepaid hook: order 'unpaid' + kini ada pembayaran lunas → order MASUK
    // (status 'paid' + item draft→sent). WAJIB sama seperti jalur webhook
    // (markPaymentPaidBySystem) — tanpa ini, pembayaran yang dikenali lewat
    // polling ("cek status", saat callback Duitku tak sampai) meninggalkan
    // order 'unpaid' selamanya: item tak pernah masuk dapur, dan order baru
    // menabrak uq_unpaid_order_per_session (crash render halaman order).
    await settleOrderIfPaid(row.orderId);
    await settleOverdueIfPaid(row.sessionId);
    await notifySessionAndStaff(row.sessionId);
    await notifyPaymentEvent(row.id, meta.isDownPayment ? "dp_confirmed" : "paid");
    revalidatePath(`/session/${row.sessionId}`);
    revalidatePath("/staff/cashier");
    return { status: "paid" };
  }

  // QR kadaluarsa / dibatalkan di Duitku (statusCode "02") → simpan 'failed'
  // supaya UI berhenti menampilkan QR mati (tombol Show QR hilang). Kalau ini
  // DP booking yg masih reserved, batalkan booking-nya juga (meja bebas).
  if (gwStatus === "failed" && row.status !== "failed") {
    await db
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(eq(payments.id, row.id));
    // Lepas reservasi voucher (bisa dipakai lagi).
    await releaseVoucherForPayment(row.id);
    const meta = (row.splitMeta as { isDownPayment?: boolean } | null) ?? {};
    if (
      meta.isDownPayment &&
      row.dpPaidAt == null &&
      (row.sessionStatus === "reserved" || row.sessionStatus === "open")
    ) {
      await db
        .update(tableSessions)
        .set({ status: "cancelled", closedAt: new Date() })
        .where(eq(tableSessions.id, row.sessionId));
      revalidatePath("/bar/[slug]", "page");
    }
    await notifySessionAndStaff(row.sessionId);
    await notifyPaymentEvent(row.id, "cancelled");
    revalidatePath(`/session/${row.sessionId}`);
    revalidatePath("/staff/cashier");
    return { status: "failed" };
  }

  return { status: gwStatus };
}

/**
 * Batalkan payment (dari sisi user/host) — dipakai tombol "Batalkan transaksi"
 * di dialog QRIS, dan saat countdown DP booking habis (00:00).
 * Otorisasi: member joined sesi ATAU staff aktif di bar (sama seperti
 * checkPaymentStatus). Kalau payment ini DP booking yg masih pending →
 * sekalian batalkan booking-nya (session 'cancelled', meja bebas lagi).
 * Idempotent: kalau sudah paid, tidak membatalkan (return paid).
 */
export async function cancelPayment(
  paymentId: string
): Promise<{ status: string; bookingCancelled: boolean }> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: payments.id,
      status: payments.status,
      splitMeta: payments.splitMeta,
      paidByMemberId: payments.paidByMemberId,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      dpPaidAt: tableSessions.dpPaidAt,
      barId: floorAreas.barId,
      barSlug: bars.slug,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(payments.id, paymentId));
  if (!row) throw new Error("Payment not found");
  if (row.status === "paid")
    return { status: "paid", bookingCancelled: false };

  // Otorisasi: PEMILIK pembayaran (paid_by_member_id) ATAU host meja ATAU staff
  // aktif di bar. Dulu "member joined mana pun" — terlalu longgar: anggota lain
  // bisa membatalkan QRIS milik orang, dan itu kehilangan data yg tak terbalik.
  // Host tetap boleh (dia penanggung jawab tagihan meja).
  // Catatan: checkPaymentStatus SENGAJA tetap longgar (semua anggota boleh cek
  // status) — hanya AKSI merusak yang diperketat di sini.
  const [asMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, row.sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  let allowed =
    !!asMember &&
    (asMember.id === row.paidByMemberId ||
      (await isSessionHost(row.sessionId, profile.id)));
  if (!allowed) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, row.barId),
          eq(staffRoles.isActive, true)
        )
      );
    allowed = !!staff;
  }
  if (!allowed) throw new Error("Not allowed");

  await db
    .update(payments)
    .set({ status: "failed", paidAt: null })
    .where(eq(payments.id, row.id));
  await releaseVoucherForPayment(row.id);

  // DP booking belum lunas → batalkan booking (meja bebas lagi). Batalkan
  // selama DP belum benar-benar terkonfirmasi (dp_paid_at NULL), baik session
  // masih 'reserved' maupun terlanjur 'open' (mis. ke-promote sebelum fix).
  const meta = (row.splitMeta as { isDownPayment?: boolean } | null) ?? {};
  let bookingCancelled = false;
  if (
    meta.isDownPayment &&
    row.dpPaidAt == null &&
    (row.sessionStatus === "reserved" || row.sessionStatus === "open")
  ) {
    await db
      .update(tableSessions)
      .set({ status: "cancelled", closedAt: new Date() })
      .where(eq(tableSessions.id, row.sessionId));
    bookingCancelled = true;
    revalidatePath("/bar/[slug]", "page");
  }

  await notifySessionAndStaff(row.sessionId);
  await notifyPaymentEvent(row.id, "cancelled");
  revalidatePath(`/session/${row.sessionId}`);
  revalidatePath("/staff/cashier");
  return { status: "cancelled", bookingCancelled };
}

/**
 * Batalkan order yang MASIH UNPAID (belum dibayar) beserta pembayaran pending-nya.
 * Dipakai saat customer klik "kembali" dari halaman pembayaran order baru lalu
 * konfirmasi batal.
 *
 * Efek: order.status = 'cancelled', semua item order → 'void', payment pending
 * (belum paid) → 'failed'. Order 'cancelled' tak muncul di dapur/kasir/tagihan.
 *
 * GUARD: hanya order berstatus 'unpaid' (order paid/closed tak bisa dibatalkan
 * lewat sini). Auth: member joined sesi ATAU staff aktif di bar (pola sama
 * dengan cancelPayment). Idempotent-ish: order yg sudah 'cancelled' → no-op.
 */
export async function cancelUnpaidOrder(
  orderId: string
): Promise<{
  status: "cancelled" | "already_paid";
  bookingCancelled?: boolean;
}> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      ownerMemberId: orders.ownerMemberId,
      sessionId: orders.sessionId,
      sessionStatus: tableSessions.status,
      dpPaidAt: tableSessions.dpPaidAt,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .where(eq(orders.id, orderId));
  if (!row) throw new Error("Order not found");

  // Order yg sudah lunas/closed tak boleh dibatalkan lewat sini.
  if (row.status === "paid" || row.status === "closed") {
    return { status: "already_paid" };
  }
  if (row.status === "cancelled") {
    return { status: "cancelled" }; // sudah batal → no-op
  }

  // Otorisasi:
  // - Order MEJA (owner NULL) → host meja atau staff aktif. Itu tagihan meja;
  //   anggota biasa tak boleh membatalkan order orang.
  // - Order milik ANGGOTA     → HANYA pemiliknya (staff tetap boleh, mereka
  //   yang menangani meja secara fisik). HOST TIDAK — dia membuka detail order
  //   anggota lalu menekan "kembali" bisa tanpa sengaja membatalkan pesanan
  //   orang lain.
  if (row.ownerMemberId) {
    const [me] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, row.sessionId),
          eq(sessionMembers.profileId, profile.id),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!me || me.id !== row.ownerMemberId) {
      // Bukan pemilik → boleh hanya kalau staff aktif di bar.
      await assertActiveStaffOfSession(row.sessionId, profile.id);
    }
  } else {
    await assertHostOrActiveStaff(row.sessionId, profile.id);
  }

  // ANTI MONEY-LOSS: sebelum membatalkan, cek ke gateway apakah ada pembayaran
  // pending yg SEBENARNYA sudah lunas (dibayar di bank tapi belum ke-refleksi
  // di DB via polling). Kalau ada → JANGAN batalkan; settle order jadi paid.
  const pendingPays = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
  if (pendingPays.length > 0) {
    const gateway = getPaymentGateway();
    for (const p of pendingPays) {
      let gwStatus: Awaited<ReturnType<typeof gateway.checkStatus>>;
      try {
        gwStatus = await gateway.checkStatus(p.id);
      } catch {
        // Gagal cek gateway → jangan ambil risiko membatalkan pembayaran yg
        // mungkin sudah lunas. Tolak cancel; user bisa coba lagi / lanjut bayar.
        throw new Error(
          "Couldn't verify the payment status. Please try again in a moment."
        );
      }
      if (gwStatus === "paid") {
        // Pembayaran ternyata lunas → settle order (jadi paid), batal cancel.
        await db
          .update(payments)
          .set({ status: "paid", paidAt: new Date() })
          .where(eq(payments.id, p.id));
        await settleOrderIfPaid(orderId);
        await notifySessionAndStaff(row.sessionId);
        revalidatePath(`/session/${row.sessionId}`);
        return { status: "already_paid" };
      }
    }
  }

  // Order ini punya DP booking yang belum terkonfirmasi? (mis. reservasi yg
  // DP-nya pay-at-cashier/QRIS belum dibayar). Kalau ya, membatalkan order =
  // membatalkan SELURUH booking: sesi 'reserved'/'open' + dp_paid_at NULL harus
  // ikut jadi 'cancelled', kalau tidak sesi 'reserved' yatim akan ke-promote
  // jadi 'open' (meja aktif) saat waktunya tiba. (Bug: cancel malah meja aktif.)
  const [pendingDp] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
      )
    )
    .limit(1);
  const cancelBooking =
    !!pendingDp &&
    row.dpPaidAt == null &&
    (row.sessionStatus === "reserved" || row.sessionStatus === "open");

  let cancelledPaymentIds: { id: string }[] = [];
  await db.transaction(async (tx) => {
    // Batalkan pembayaran pending/failed (belum paid) yang menempel di order.
    cancelledPaymentIds = await tx
      .update(payments)
      .set({ status: "failed", paidAt: null })
      .where(and(eq(payments.orderId, orderId), ne(payments.status, "paid")))
      .returning({ id: payments.id });
    // Void semua item (biar tak terhitung di agregat manapun).
    await tx
      .update(orderItems)
      .set({ status: "void" })
      .where(eq(orderItems.orderId, orderId));
    // Tandai order cancelled.
    await tx
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, orderId));
    // Booking belum terkonfirmasi → batalkan sesinya juga (meja bebas lagi).
    if (cancelBooking) {
      await tx
        .update(tableSessions)
        .set({ status: "cancelled", closedAt: new Date() })
        .where(eq(tableSessions.id, row.sessionId));
    }
  });

  // Lepas reservasi voucher pada payment yang ikut dibatalkan (pasca-commit).
  for (const pRow of cancelledPaymentIds) {
    await releaseVoucherForPayment(pRow.id);
  }

  await notifySessionAndStaff(row.sessionId);
  revalidatePath(`/session/${row.sessionId}`);
  revalidatePath("/staff/cashier");
  revalidatePath("/staff/waiter");
  if (cancelBooking) revalidatePath("/bar/[slug]", "page");
  return { status: "cancelled", bookingCancelled: cancelBooking };
}
