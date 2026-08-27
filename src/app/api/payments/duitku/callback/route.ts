import { NextRequest, NextResponse } from "next/server";
import { verifyDuitkuCallback } from "@/lib/payments/gateway";
import { markPaymentPaidBySystem } from "@/lib/cashier-actions";
import { activateMembershipTx } from "@/lib/membership-actions";

/**
 * Callback (webhook) Duitku — dipanggil server Duitku saat status transaksi
 * berubah. Body form-urlencoded berisi: merchantCode, amount, merchantOrderId,
 * resultCode, reference, signature, dll.
 *
 * Keamanan: verifikasi signature MD5(merchantCode+amount+merchantOrderId+apiKey).
 * resultCode "00" = sukses. merchantOrderId = payment.id (kita set saat inquiry).
 *
 * WAJIB balas HTTP 200 supaya Duitku tak retry berulang.
 */
/**
 * Catat kejadian callback ke activity_logs — jejak yang bertahan setelah log
 * PM2 dirotasi.
 *
 * Sukses TIDAK dicatat di sini: pembayaran meja sudah dicatat logSystem di
 * markPaymentPaidBySystem, dan membership di activateMembershipTx. Yang
 * dicatat hanya jalur GAGAL, yang sebelumnya tak berjejak sama sekali.
 *
 * barId diambil dari bar pertama (sistem ini satu-bar); kegagalan mencatat
 * tak boleh menggagalkan callback — Duitku akan retry kalau kita balas
 * non-200, padahal pembayarannya sendiri mungkin sudah beres.
 */
async function logPaymentCallback(input: {
  action: string;
  summary: string;
  meta: Record<string, unknown>;
}): Promise<void> {
  try {
    const { db } = await import("@/lib/db/client");
    const { bars } = await import("@/lib/db/schema/venue");
    const { asc } = await import("drizzle-orm");
    const { logSystem } = await import("@/lib/activity-log");

    const [bar] = await db
      .select({ id: bars.id })
      .from(bars)
      .orderBy(asc(bars.createdAt))
      .limit(1);
    if (!bar) return;

    await logSystem({
      barId: bar.id,
      action: input.action,
      category: "payment",
      entityType: "payment",
      summary: input.summary,
      meta: input.meta,
    });
  } catch (err) {
    console.error("[duitku/callback] gagal mencatat jejak:", err);
  }
}

export async function POST(req: NextRequest) {
  let params: URLSearchParams;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = await req.json();
      params = new URLSearchParams(
        Object.entries(json).map(([k, v]) => [k, String(v)])
      );
    } else {
      const text = await req.text();
      params = new URLSearchParams(text);
    }
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const merchantCode = params.get("merchantCode") ?? "";
  const amount = params.get("amount") ?? "";
  const merchantOrderId = params.get("merchantOrderId") ?? "";
  const resultCode = params.get("resultCode") ?? "";
  const signature = params.get("signature") ?? "";

  // Jejak MASUK — tanpa ini jalur sukses senyap total, sehingga "callback tak
  // pernah datang" tak bisa dibedakan dari "callback datang & lancar". Itu yg
  // bikin diagnosa 2026-07-20 berputar lama. Jangan log signature/apiKey.
  console.log("[duitku/callback] masuk", {
    merchantOrderId,
    resultCode,
    amount,
  });

  // 1. Verifikasi signature — tolak kalau tak valid (cegah spoofing).
  const valid = verifyDuitkuCallback({
    merchantCode,
    amount,
    merchantOrderId,
    signature,
  });
  if (!valid) {
    // Bedakan sebabnya — "apiKey kosong" dan "merchantCode beda" bergejala
    // sama (callback masuk tapi diabaikan senyap) tapi perbaikannya beda.
    console.error("[duitku/callback] signature tidak valid", {
      merchantOrderId,
      apiKeyKosong: !process.env.DUITKU_API_KEY,
      merchantCodeMasuk: merchantCode,
      merchantCodeEnv: process.env.DUITKU_MERCHANT_CODE ?? "(tak diset)",
    });
    // Jejak PERMANEN: console.log hilang saat log PM2 dirotasi, sedangkan
    // signature tak valid hampir selalu berarti salah konfigurasi yang perlu
    // ditelusuri berhari-hari kemudian. SENGAJA tanpa signature/apiKey.
    await logPaymentCallback({
      action: "payment.callback_rejected",
      summary: `Duitku callback rejected — invalid signature (${merchantOrderId || "no order id"})`,
      meta: {
        merchantOrderId,
        resultCode,
        apiKeyKosong: !process.env.DUITKU_API_KEY,
        merchantCodeMasuk: merchantCode,
      },
    });
    // Balas 200 supaya Duitku berhenti retry (tapi jangan proses).
    return new NextResponse("Invalid signature", { status: 200 });
  }

  // 2. resultCode "00" = sukses → tandai lunas (idempotent).
  //
  // merchantOrderId bisa merujuk DUA entitas berbeda, karena keduanya memanggil
  // createCharge dgn id barisnya sendiri sebagai paymentId:
  //   - payments.id                  → tagihan meja / order menu
  //   - membership_transactions.id   → pembelian langganan membership
  // markPaymentPaidBySystem hanya melihat tabel payments dan mengembalikan null
  // kalau tak ketemu; tanpa fallback ini pembayaran membership diam-diam
  // terabaikan (callback tetap balas 200 → Duitku tak retry).
  if (resultCode === "00" && merchantOrderId) {
    try {
      const paid = await markPaymentPaidBySystem(merchantOrderId);
      if (paid) {
        console.log("[duitku/callback] payment lunas", { merchantOrderId });
      } else {
        const activated = await activateMembershipTx(merchantOrderId);
        if (activated) {
          console.log("[duitku/callback] membership aktif", {
            merchantOrderId,
          });
        } else {
          // Bukan payment, bukan membership pending (atau sudah diproses).
          // Bukan error — jangan minta Duitku retry.
          console.warn("[duitku/callback] tak ada baris pending untuk", {
            merchantOrderId,
          });
          // Ini kasus PALING berbahaya: uang masuk tapi tak terkait ke
          // apa pun. Wajib punya jejak permanen — tamu akan menagih.
          await logPaymentCallback({
            action: "payment.callback_unmatched",
            summary: `Duitku callback had no matching pending row (${merchantOrderId})`,
            meta: { merchantOrderId, resultCode, amount },
          });
        }
      }
    } catch (err) {
      console.error("[duitku/callback] gagal update payment", err);
      // Balas non-200 supaya Duitku retry.
      return new NextResponse("Processing error", { status: 500 });
    }
  }

  // Selalu 200 untuk sukses/failed yang sudah diproses.
  return new NextResponse("OK", { status: 200 });
}
