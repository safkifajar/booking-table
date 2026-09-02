"use server";

/**
 * Server Action pembayaran tagihan — payShare.
 *
 * Dipisah dari actions.ts sebagai kelanjutan pemecahan berkas 5.208 baris itu.
 * Batasnya diambil dari blok "PAYMENTS" yang sudah berdiri sendiri: satu
 * fungsi dengan satu skema yang tak dipakai bagian lain.
 *
 * DIDAHULUKAN sebelum SPLIT BATCH yang lebih besar: split batch memanggil
 * jalur pembayaran, jadi memindahkan yang dipanggil lebih dulu membuat
 * batasnya jelas saat giliran pemanggilnya.
 *
 * Berkas ini bertanda "use server" — Next.js melarangnya mengekspor apa pun
 * selain fungsi async, jadi skema Zod di bawah sengaja TIDAK diekspor dan
 * tipe kembalian payShare ditulis inline.
 */

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import {
  orders,
  orderItems,
  payments,
  paymentItems,
} from "@/lib/db/schema/orders";
import { staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { requireProfile } from "@/lib/auth-v2/current";
import { isSessionHost } from "@/lib/auth-v2/session-auth";
import { formatIDR } from "@/lib/utils";
import { notifySessionAndStaff } from "@/lib/session-shared";
import {
  settleOverdueIfPaid,
  getOutstandingMap,
  getOrderOutstanding,
  settleOrderIfPaid,
  PAY_AT_CASHIER_TIMEOUT_SECONDS,
} from "@/lib/queries";
import { notifyCashiersPayAtCashier } from "@/lib/payment-notify";
import {
  resolveVoucherForBillPayment,
  reserveVoucherForPayment,
  settleVoucherForPayment,
} from "@/lib/member-voucher";
import { settleRevenueSplitForPayment } from "@/lib/revenue-split";
import { getPaymentGateway } from "@/lib/payments/gateway";
import type { PaymentStatus } from "@/types/db";

const paySchema = z.object({
  sessionId: z.string().uuid(),
  /** Multi-order: order spesifik yang dibayar. Kalau tak diberi → fallback ke
   *  order aktif sesi (kompat lama). (PRD Multi-Order Prepaid FR17.) */
  orderId: z.string().uuid().optional(),
  amount: z.number().int().positive(),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
  splitMode: z.enum(["equal", "itemized", "custom"]),
  splitMeta: z.record(z.string(), z.unknown()).optional(),
  /** Kode voucher benefit membership (PRD Membership rev-2) — opsional. */
  voucherCode: z.string().trim().max(20).optional(),
});

/**
 * Customer self-pay flow (customer bayar sendiri dari HP setelah pesan).
 *
 * Flow:
 * 1. Verify member ada di session
 * 2. Insert payment dengan status='pending'
 * 3. Call gateway abstraction (getPaymentGateway().createCharge)
 * 4. Update payment dengan external_ref + status dari gateway
 * 5. Return result termasuk qrString (untuk QRIS) atau redirectUrl
 *
 * Sekarang implementasi gateway masih mock (auto-paid). Saat production swap
 * ke Xendit/Midtrans, tidak perlu sentuh function ini — cuma implement adapter
 * baru di lib/payments/gateway.ts.
 */
export async function payShare(input: z.infer<typeof paySchema>): Promise<{
  paymentId: string;
  status: PaymentStatus;
  externalRef: string;
  qrString: string | null;
  redirectUrl: string | null;
  expiresAt: string | null;
}> {
  const profile = await requireProfile();
  const data = paySchema.parse(input);

  // 1. Member + profile lookup (butuh display_name untuk receipt gateway).
  let [member] = await db
    .select({ id: sessionMembers.id, displayName: profiles.displayName })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, data.sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  // Siapa boleh bayar apa:
  // - Order MEJA (owner NULL)  → hanya HOST (atau staff, cabang di bawah).
  //   Di sinilah split equally & treat hidup — tak berubah dari sebelumnya.
  // - Order milik ANGGOTA      → hanya PEMILIKNYA (atau host/staff sbg
  //   penanggung jawab meja). Dia bayar penuh ordernya sendiri, tanpa split.
  // (Pengecekan sesungguhnya dilakukan SETELAH order di-resolve di langkah 2 —
  // orderId opsional, jadi pemiliknya belum bisa diketahui di titik ini.)
  const callerIsHost = await isSessionHost(data.sessionId, profile.id);
  // Staff (waiter/kasir) yang membayar atas nama meja: bukan member sendiri,
  // pembayaran diatribusikan ke host. Guard "siapa boleh bayar apa" (2b) TIDAK
  // berlaku untuk mereka — mereka penanggung jawab meja, boleh bayar order meja
  // maupun order anggota. Tanpa flag ini, `member` sudah di-reassign ke host di
  // bawah dan guard 2b keliru memblokir (member truthy, bukan host, owner NULL).
  let callerIsStaffSubstitute = false;

  // Payer bukan member → boleh kalau STAFF aktif di bar sesi (waiter terima
  // pembayaran atas nama meja). Pembayaran diatribusikan ke HOST member.
  if (!member) {
    const [sess] = await db
      .select({ host_id: tableSessions.hostId, bar_id: floorAreas.barId })
      .from(tableSessions)
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
      .where(eq(tableSessions.id, data.sessionId));
    if (!sess) throw new Error("Table not found");

    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, sess.bar_id),
          eq(staffRoles.isActive, true)
        )
      );
    if (!staff) throw new Error("Not a member of this table");

    // Atribusi ke host member meja.
    const [hostMember] = await db
      .select({ id: sessionMembers.id, displayName: profiles.displayName })
      .from(sessionMembers)
      .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
      .where(
        and(
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.profileId, sess.host_id)
        )
      );
    if (!hostMember) throw new Error("Table host not found");
    member = hostMember;
    callerIsStaffSubstitute = true;
  }

  // 2. Order untuk dibayar. Multi-order: kalau orderId diberi → pakai order itu
  // (dicek milik sesi). Kalau tidak → fallback lama (order non-closed sesi).
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
    if (!order) {
      const outstanding =
        (await getOutstandingMap([data.sessionId])).get(data.sessionId) ?? 0;
      if (outstanding <= 0) throw new Error("The bill is already paid");
      const [anyOrder] = await db
        .select({ id: orders.id, ownerMemberId: orders.ownerMemberId })
        .from(orders)
        // Tetap order MEJA — fallback terakhir pun tak boleh menyasar order
        // pribadi anggota.
        .where(
          and(
            eq(orders.sessionId, data.sessionId),
            isNull(orders.ownerMemberId)
          )
        )
        .orderBy(desc(orders.createdAt))
        .limit(1);
      order = anyOrder;
    }
  }
  if (!order) throw new Error("Order not found");

  // 2b. Siapa boleh bayar apa (baru bisa dicek di sini — orderId opsional, jadi
  //     pemilik order belum diketahui saat auth di langkah 1):
  //     - Order MEJA (owner NULL) → hanya HOST/staff. Di sinilah split equally
  //       & treat hidup; tak berubah dari sebelumnya.
  //     - Order milik ANGGOTA     → hanya PEMILIKNYA (host/staff tetap boleh
  //       sbg penanggung jawab meja). Bayar penuh, tanpa split.
  if (
    member &&
    !callerIsHost &&
    !callerIsStaffSubstitute &&
    order.ownerMemberId !== member.id
  ) {
    throw new Error("Only the table host can create payments");
  }

  // 2c. ANTI LEBIH BAYAR: sisa tagihan yang masih "kosong" = outstanding −
  //     Σ(QRIS pending yang masih hidup). Saat split sudah di-generate & anggota
  //     lain belum bayar, sisa itu sudah dipesan QRIS mereka — membuat pembayaran
  //     baru di atasnya berisiko dibayar dua kali. (DP dikecualikan: alur booking
  //     memang membuat DP lalu pelunasan.)
  const isDpPayment =
    !!(data.splitMeta as { isDownPayment?: boolean } | undefined)?.isDownPayment;
  if (!isDpPayment) {
    const { outstanding: outNow } = await getOrderOutstanding(order.id);
    const livePendings = await db
      .select({ amount: payments.amount, splitMeta: payments.splitMeta })
      .from(payments)
      .where(
        and(eq(payments.orderId, order.id), eq(payments.status, "pending"))
      );
    const nowMs = Date.now();
    const pendingLive = livePendings.reduce((sum, p) => {
      const m = (p.splitMeta as { expiresAt?: string | null } | null) ?? {};
      const exp = m.expiresAt ? new Date(m.expiresAt).getTime() : null;
      const alive = exp == null || exp > nowMs; // tanpa expiry → anggap hidup
      return alive ? sum + p.amount : sum;
    }, 0);
    const uncovered = Math.max(0, outNow - pendingLive);
    if (uncovered <= 0) {
      throw new Error(
        "The remaining bill is already covered by active QRIS payments. Wait for them to be paid or to expire."
      );
    }
    if (data.amount > uncovered) {
      throw new Error(
        `You can pay at most ${formatIDR(uncovered)} right now. The rest is covered by active QRIS payments.`
      );
    }
  }

  // 2d. Voucher benefit membership (PRD Membership rev-2). Divalidasi ULANG
  //     di sini (UI sudah preview via previewBillVoucher) — devtools tak bisa
  //     memaksakan kode orang lain/terpakai. Diskon dicatat sbg baris payments
  //     method='voucher' TERPISAH saat payment utama PAID, jadi outstanding
  //     bill tertutup benar.
  let voucher: { voucherId: string; code: string; discount: number } | null =
    null;
  if (data.voucherCode?.trim()) {
    const res = await resolveVoucherForBillPayment({
      code: data.voucherCode,
      sessionId: data.sessionId,
      amount: data.amount,
    });
    if (!res.ok) throw new Error(res.error);
    voucher = {
      voucherId: res.voucher.voucherId,
      code: res.voucher.code,
      discount: res.voucher.discount,
    };
  }
  const chargeAmount = data.amount - (voucher?.discount ?? 0);

  // Diskon menutup SELURUH nominal → tak ada yang perlu ditagih: cukup baris
  // voucher (paid) — tanpa gateway, tanpa QR. CHECK amount > 0 di payments
  // melarang baris 0, jadi payment utama tidak dibuat sama sekali.
  if (voucher && chargeAmount <= 0) {
    const [voucherPayment] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        paidByMemberId: member.id,
        amount: voucher.discount,
        method: "voucher",
        status: "paid",
        splitMode: data.splitMode,
        splitMeta: { voucherCode: voucher.code, voucherId: voucher.voucherId },
        paidAt: new Date(),
      })
      .returning({ id: payments.id });
    // Tandai voucher USED menempel ke baris ini (reserve+settle sekali jalan;
    // kalah race → voucher keburu dipakai → batalkan baris tadi).
    const reserved = await reserveVoucherForPayment(
      voucher.voucherId,
      voucherPayment.id,
      voucher.discount
    );
    if (!reserved) {
      await db.delete(payments).where(eq(payments.id, voucherPayment.id));
      throw new Error("This voucher was just used. Try another one");
    }
    // Tandai used_at TANPA mencetak baris diskon lagi — baris voucherPayment
    // di atas SUDAH menjadi pembayarannya (skipSyntheticRow).
    await settleVoucherForPayment(voucherPayment.id, { skipSyntheticRow: true });
    await settleOrderIfPaid(order.id);
    await settleOverdueIfPaid(data.sessionId);
    await notifySessionAndStaff(data.sessionId);
    revalidatePath(`/session/${data.sessionId}`);
    revalidatePath("/staff/cashier");
    return {
      paymentId: voucherPayment.id,
      status: "paid" as PaymentStatus,
      externalRef: "",
      qrString: null,
      redirectUrl: null,
      expiresAt: null,
    };
  }

  // 3. Insert payment dengan status='pending'. Nominal = SETELAH potongan
  //    voucher (baris diskon menyusul saat paid).
  const [newPayment] = await db
    .insert(payments)
    .values({
      orderId: order.id,
      paidByMemberId: member.id,
      amount: chargeAmount,
      method: data.method,
      status: "pending",
      splitMode: data.splitMode,
      splitMeta: {
        ...(data.splitMeta ?? {}),
        ...(voucher
          ? { voucherCode: voucher.code, voucherDiscount: voucher.discount }
          : {}),
      },
      paidAt: null,
    })
    .returning({ id: payments.id });

  // Reservasi voucher ke payment ini (race-safe). Kalah race → payment batal.
  if (voucher) {
    const reserved = await reserveVoucherForPayment(
      voucher.voucherId,
      newPayment.id,
      voucher.discount
    );
    if (!reserved) {
      await db
        .update(payments)
        .set({ status: "failed" })
        .where(eq(payments.id, newPayment.id));
      throw new Error("This voucher was just used. Try another one");
    }
  }

  // 3b. Treat (custom, bayar penuh): tautkan SEMUA item order ke payment ini
  // supaya halaman detail transaksi bisa menampilkan seluruh item meja (Q3).
  // itemized ditangani createSplitBatch; equal/DP tidak menulis payment_items.
  if (data.splitMode === "custom") {
    const orderItemsForTreat = await db
      .select({
        id: orderItems.id,
        qty: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
      })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, order.id), ne(orderItems.status, "void")));
    if (orderItemsForTreat.length > 0) {
      await db.insert(paymentItems).values(
        orderItemsForTreat.map((it) => ({
          paymentId: newPayment.id,
          orderItemId: it.id,
          amount: it.qty * it.unitPrice,
        }))
      );
    }
  }

  // 4. Call gateway abstraction. Mock → auto-paid. Real gateway → pending + qrString.
  //    KECUALI "Pay at cashier" (method cash dari customer): TANPA gateway —
  //    payment tetap 'pending' sampai KASIR konfirmasi uang diterima
  //    (cashierMarkPaymentPaid). Selama pending, order tak masuk dapur.
  if (data.method === "cash") {
    const cashierExpiresAt = new Date(
      Date.now() + PAY_AT_CASHIER_TIMEOUT_SECONDS * 1000
    ).toISOString();
    await db
      .update(payments)
      .set({
        externalRef: `cashier_${newPayment.id}`,
        splitMeta: {
          ...(data.splitMeta ?? {}),
          ...(voucher
            ? { voucherCode: voucher.code, voucherDiscount: voucher.discount }
            : {}),
          payAtCashier: true,
          // Batas 10 menit (sama dgn DP booking) → sumber countdown di halaman
          // bayar + banner, dan deadline untuk lazy-expire (order dibatalkan,
          // MEJA tetap open). Dulu null → pending menggantung selamanya.
          expiresAt: cashierExpiresAt,
        },
      })
      .where(eq(payments.id, newPayment.id));

    await notifySessionAndStaff(data.sessionId);
    // Kabari kasir: ada bill yang mau dibayar di kasir → siap terima & konfirmasi.
    await notifyCashiersPayAtCashier({
      paymentId: newPayment.id,
      isDownPayment: false,
    });
    revalidatePath(`/session/${data.sessionId}`);
    revalidatePath("/staff/cashier");
    revalidatePath(`/staff/cashier/${data.sessionId}`);
    return {
      paymentId: newPayment.id,
      status: "pending" as PaymentStatus,
      externalRef: `cashier_${newPayment.id}`,
      qrString: null,
      redirectUrl: null,
      expiresAt: cashierExpiresAt,
    };
  }

  const gateway = getPaymentGateway();
  let chargeResult;
  try {
    chargeResult = await gateway.createCharge({
      paymentId: newPayment.id,
      amount: chargeAmount,
      method: data.method,
      payerName: member.displayName,
      description: `Self-pay table - ${data.sessionId.slice(0, 8)}`,
    });
  } catch (err) {
    // Gateway menolak (mis. kanal QRIS tak aktif) — baris pending yang sudah
    // tersimpan HARUS dibuang.
    //
    // Kalau dibiarkan, ia tak pernah punya expiresAt, dan penjagaan
    // anti-bayar-ganda di atas menganggap pembayaran tanpa expiry sebagai
    // "masih hidup" — sehingga tagihan terkunci SELAMANYA dan tamu tak bisa
    // mencoba lagi dengan cara apa pun.
    await db.delete(payments).where(eq(payments.id, newPayment.id));
    throw err;
  }

  // 5. Update payment dengan hasil gateway (+ metadata QRIS di split_meta).
  await db
    .update(payments)
    .set({
      externalRef: chargeResult.externalRef,
      status: chargeResult.status,
      paidAt: chargeResult.status === "paid" ? new Date() : null,
      splitMeta: {
        ...(data.splitMeta ?? {}),
        qrString: chargeResult.qrString ?? null,
        redirectUrl: chargeResult.redirectUrl ?? null,
        expiresAt: chargeResult.expiresAt ?? null,
        merchantOrderId: chargeResult.merchantOrderId ?? newPayment.id,
      },
    })
    .where(eq(payments.id, newPayment.id));

  // Kalau sesi 'overdue' (lewat waktu tapi nunggak) dan kini lunas → tutup.
  if (chargeResult.status === "paid") {
    // Voucher → cetak baris diskon DULU supaya settle melihat total penuh.
    await settleVoucherForPayment(newPayment.id);
    // Bagi hasil service fee (best-effort — jangan gagalkan pembayaran).
    await settleRevenueSplitForPayment(newPayment.id).catch((e) =>
      console.error("[split] payShare:", e)
    );
    // Prepaid hook: order 'unpaid' yang kini terbayar → MASUK (paid + item sent).
    await settleOrderIfPaid(order.id);
    await settleOverdueIfPaid(data.sessionId);
  }

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
  // Invalidate staff dashboards juga supaya cashier list & detail auto-update
  // saat customer self-pay
  revalidatePath("/staff/cashier");
  revalidatePath(`/staff/cashier/${data.sessionId}`);

  return {
    paymentId: newPayment.id,
    status: chargeResult.status,
    externalRef: chargeResult.externalRef,
    qrString: chargeResult.qrString ?? null,
    redirectUrl: chargeResult.redirectUrl ?? null,
    expiresAt: chargeResult.expiresAt ?? null,
  };
}
