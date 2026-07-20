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
