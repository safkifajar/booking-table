import { NextRequest, NextResponse } from "next/server";
import { verifyDuitkuCallback } from "@/lib/payments/gateway";
import { markPaymentPaidBySystem } from "@/lib/cashier-actions";

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

  // 1. Verifikasi signature — tolak kalau tak valid (cegah spoofing).
  const valid = verifyDuitkuCallback({
    merchantCode,
    amount,
    merchantOrderId,
    signature,
  });
  if (!valid) {
    console.error("[duitku/callback] signature tidak valid", {
      merchantOrderId,
    });
    // Balas 200 supaya Duitku berhenti retry (tapi jangan proses).
    return new NextResponse("Invalid signature", { status: 200 });
  }

  // 2. resultCode "00" = sukses → tandai payment lunas (idempotent).
  if (resultCode === "00" && merchantOrderId) {
    try {
      await markPaymentPaidBySystem(merchantOrderId);
    } catch (err) {
      console.error("[duitku/callback] gagal update payment", err);
      // Balas non-200 supaya Duitku retry.
      return new NextResponse("Processing error", { status: 500 });
    }
  }

  // Selalu 200 untuk sukses/failed yang sudah diproses.
  return new NextResponse("OK", { status: 200 });
}
