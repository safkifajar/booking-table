import "server-only";

/**
 * Payment gateway abstraction.
 *
 * Sekarang impl-nya `mock` (manual mark paid). Production akan swap ke
 * Xendit/Midtrans/dll tanpa sentuh business logic di Server Actions.
 *
 * Setup convention:
 * - PAYMENT_GATEWAY=mock (default) — semua method jadi manual mark paid
 * - PAYMENT_GATEWAY=xendit — call Xendit API
 * - PAYMENT_GATEWAY=midtrans — call Midtrans API
 *
 * Gateway return external_ref yang disimpan di payments.external_ref untuk
 * audit trail + reconciliation nanti.
 */

import type {
  PaymentMethod,
  PaymentStatus,
} from "@/types/db";

export interface CreateChargeInput {
  /** Internal payment id — pakai sebagai external_id ke gateway */
  paymentId: string;
  /** Total amount IDR (integer) */
  amount: number;
  /** Method untuk routing gateway-side (qris/card/gopay/dst) */
  method: PaymentMethod;
  /** Display name customer untuk receipt gateway */
  payerName: string;
  /** Description untuk customer & merchant statement */
  description: string;
}

export interface ChargeResult {
  /** ID dari gateway (xendit invoice id, midtrans transaction_id, dst) */
  externalRef: string;
  /**
   * Status awal. Untuk QRIS biasanya `pending` (tunggu user scan & bayar).
   * Untuk mock gateway, langsung `paid`.
   */
  status: PaymentStatus;
  /**
   * Untuk QRIS: QR code string yang bisa di-render jadi image.
   * Untuk method lain: null.
   */
  qrString?: string | null;
  /**
   * Untuk redirect-based (Snap/Checkout page), URL yang di-redirect.
   * Untuk method lain: null.
   */
  redirectUrl?: string | null;
  /**
   * Untuk QRIS: kapan QR kedaluwarsa (ISO string). null kalau tak ada.
   */
  expiresAt?: string | null;
  /**
   * Referensi order yang dikirim ke gateway (mis. merchantOrderId Duitku).
   * Disimpan utk lookup saat callback. Default = paymentId.
   */
  merchantOrderId?: string | null;
}

export interface PaymentGateway {
  /**
   * Buat charge baru di gateway.
   * Caller: Server Action setelah insert row payments dengan status=pending.
   */
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;

  /**
   * Cek status payment di gateway. Dipakai untuk polling (saat customer scan
   * QRIS) atau verifikasi manual lewat tombol "Cek Status" di kasir.
   *
   * Argumennya merchantOrderId (= payments.id kita), BUKAN reference gateway.
   */
  checkStatus(merchantOrderId: string): Promise<PaymentStatus>;
}

// ============================================================
// MOCK GATEWAY — manual mark paid
// ============================================================

const mockGateway: PaymentGateway = {
  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    // Mock: generate fake external ref, status langsung paid (kasir akan
    // konfirmasi manual customer sudah bayar — mirror behavior payment
    // gateway sukses langsung).
    //
    // Untuk QRIS, generate dummy QR string supaya UI bisa render preview.
    // String ini tidak valid sebagai EMV QRIS — cuma placeholder visual.
    const externalRef = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    if (input.method === "qris") {
      // Dummy QR payload — visual only
      const qrString = `00020101021126540011ID.DANA.WWW011893600914${input.paymentId.slice(
        0,
        12
      )}5204594553033605802ID5910SOHO BOOKING6013PURWOKERTO61055321162070703A0163041234`;
      return {
        externalRef,
        status: "paid",
        qrString,
      };
    }

    return {
      externalRef,
      status: "paid",
    };
  },

  async checkStatus(merchantOrderId: string): Promise<PaymentStatus> {
    // Mock: selalu anggap lunas. Dulu mensyaratkan awalan "mock_" — padahal
    // yang dikirim pemanggil adalah merchantOrderId (payments.id, sebuah
    // UUID), jadi tombol "Cek Status" TIDAK PERNAH melunasi di mode mock.
    void merchantOrderId;
    return "paid";
  },
};

// ============================================================
// DUITKU GATEWAY (API Redirect/Merchant — inquiry v2)
// Docs: https://docs.duitku.com/api/en/
// - Inquiry:  {base}/webapi/api/merchant/v2/inquiry
//   signature = MD5(merchantCode + merchantOrderId + paymentAmount + apiKey)
// - Status:   {base}/webapi/api/merchant/transactionStatus
//   signature = MD5(merchantCode + merchantOrderId + apiKey)
// - Callback verify (di route): MD5(merchantCode + amount + merchantOrderId + apiKey)
// QRIS paymentMethod: diatur lewat DUITKU_QRIS_CHANNEL (NQ=Nobu, SP=ShopeePay,
// DQ=DANA, LQ=LinkAja, SQ=Nusapay, GQ=Gudang Voucher). Default "SP".
// ============================================================

import { createHash } from "node:crypto";

/**
 * Masa berlaku QR QRIS (menit) untuk pembayaran bill biasa (Treat/Split).
 * Setelah lewat, Duitku menolak & transactionStatus jadi expired ("02").
 * DP booking punya timeout sendiri (1 menit, di queries.ts) yg lebih ketat.
 */
const QRIS_EXPIRY_MINUTES = 5;

function md5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** Konfigurasi Duitku dari env (dibaca lazy supaya build tak butuh env). */
function duitkuConfig() {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE ?? "";
  const apiKey = process.env.DUITKU_API_KEY ?? "";
  const env = (process.env.DUITKU_ENV ?? "sandbox").toLowerCase();
  const base =
    env === "production"
      ? "https://passport.duitku.com"
      : "https://sandbox.duitku.com";
  const callbackUrl = process.env.DUITKU_CALLBACK_URL ?? "";
  const returnUrl = process.env.DUITKU_RETURN_URL ?? callbackUrl;
  if (!merchantCode || !apiKey) {
    throw new Error(
      "Duitku belum dikonfigurasi: set DUITKU_MERCHANT_CODE & DUITKU_API_KEY di env."
    );
  }
  return { merchantCode, apiKey, env, base, callbackUrl, returnUrl };
}

/**
 * Kode kanal QRIS di Duitku, bisa diatur lewat env DUITKU_QRIS_CHANNEL.
 *
 * Kode ini HARUS cocok dengan kanal yang AKTIF di dashboard Duitku. Kalau
 * tidak, Duitku menolak permintaannya & tamu melihat "QRIS unavailable" —
 * mengaktifkan kanal lain di dashboard tak menolong selama kode di sini
 * masih menunjuk kanal yang dimatikan.
 *
 * Kode yang tersedia (per dokumentasi Duitku):
 *   NQ = Nobu     SP = ShopeePay   DQ = DANA
 *   LQ = LinkAja  SQ = Nusapay     GQ = Gudang Voucher
 *
 * Default "SP" mempertahankan perilaku sebelumnya untuk pemasangan yang
 * belum menyetel env ini.
 */
function qrisChannelCode(): string {
  const kode = process.env.DUITKU_QRIS_CHANNEL?.trim().toUpperCase();
  return kode && kode.length > 0 ? kode : "SP";
}

/** Map PaymentMethod internal → kode paymentMethod Duitku. */
function duitkuMethodCode(method: PaymentMethod): string {
  if (method === "qris") return qrisChannelCode();
  // Metode lain belum punya pemetaan sendiri — diperlakukan sebagai QRIS.
  return qrisChannelCode();
}

const duitkuGateway: PaymentGateway = {
  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    // Hanya QRIS yang lewat Duitku. Cash/card = pembayaran fisik (uang tunai /
    // EDC) → langsung 'paid' tanpa panggil gateway (kasir konfirmasi manual).
    if (input.method !== "qris") {
      return {
        externalRef: `manual_${input.method}_${input.paymentId}`,
        status: "paid",
      };
    }

    const cfg = duitkuConfig();
    // merchantOrderId harus unik per transaksi. Pakai paymentId (uuid) —
    // tapi Duitku batasi panjang; ambil bentuk ringkas + timestamp.
    const merchantOrderId = input.paymentId;
    const paymentAmount = Math.round(input.amount); // integer rupiah
    const signature = md5(
      cfg.merchantCode + merchantOrderId + paymentAmount + cfg.apiKey
    );

    const body = {
      merchantCode: cfg.merchantCode,
      paymentAmount,
      paymentMethod: duitkuMethodCode(input.method),
      merchantOrderId,
      productDetails: input.description.slice(0, 255),
      customerVaName: input.payerName.slice(0, 20) || "Customer",
      callbackUrl: cfg.callbackUrl,
      returnUrl: cfg.returnUrl,
      signature,
      expiryPeriod: QRIS_EXPIRY_MINUTES, // menit — QR kadaluarsa setelah ini
    };

    const res = await fetch(`${cfg.base}/webapi/api/merchant/v2/inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Server-to-server; jangan cache.
      cache: "no-store",
    });
    const text = await res.text();
    let data: {
      statusCode?: string;
      statusMessage?: string;
      reference?: string;
      paymentUrl?: string;
      qrString?: string;
    } = {};
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Duitku inquiry gagal (HTTP ${res.status}): ${text.slice(0, 200)}`
      );
    }
    if (!res.ok || data.statusCode !== "00" || !data.reference) {
      throw new Error(
        `Duitku menolak transaksi: ${data.statusMessage ?? text.slice(0, 200)}`
      );
    }

    return {
      externalRef: data.reference,
      // QRIS: tunggu customer scan & bayar → callback yang menandai paid.
      status: "pending",
      qrString: data.qrString ?? null,
      redirectUrl: data.paymentUrl ?? null,
      merchantOrderId,
      // Kadaluarsa QRIS_EXPIRY_MINUTES dari sekarang (samakan dgn expiryPeriod).
      expiresAt: new Date(
        Date.now() + QRIS_EXPIRY_MINUTES * 60 * 1000
      ).toISOString(),
    };
  },

  async checkStatus(merchantOrderId: string): Promise<PaymentStatus> {
    // PENTING: Duitku transactionStatus di-lookup by merchantOrderId, BUKAN
    // reference. merchantOrderId kita = payments.id (lihat pemanggil di
    // cashierCheckPaymentStatus). Parameter ini dulu bernama `externalRef`
    // sehingga terbaca seolah memakai data.reference — menyesatkan, karena
    // externalRef yang tersimpan di DB justru berisi reference Duitku.
    const cfg = duitkuConfig();
    const signature = md5(cfg.merchantCode + merchantOrderId + cfg.apiKey);
    const res = await fetch(
      `${cfg.base}/webapi/api/merchant/transactionStatus`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantCode: cfg.merchantCode,
          merchantOrderId,
          signature,
        }),
        cache: "no-store",
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      statusCode?: string;
    };
    // Duitku: statusCode "00" = SUCCESS, "01" = PENDING, "02" = FAILED/CANCEL.
    if (data.statusCode === "00") return "paid";
    if (data.statusCode === "02") return "failed";
    return "pending";
  },
};

// ============================================================
// GATEWAY SELECTOR
// ============================================================

export function getPaymentGateway(): PaymentGateway {
  // Baca env saat dipanggil (bukan module-load) supaya tak ter-cache stale.
  const driver = process.env.PAYMENT_GATEWAY ?? "mock";
  if (driver === "mock") return mockGateway;
  if (driver === "duitku") return duitkuGateway;

  throw new Error(
    `Unknown PAYMENT_GATEWAY: ${driver}. Supported: mock, duitku`
  );
}

/** Verifikasi signature callback Duitku (dipakai di route callback). */
export function verifyDuitkuCallback(params: {
  merchantCode: string;
  amount: string;
  merchantOrderId: string;
  signature: string;
}): boolean {
  const apiKey = process.env.DUITKU_API_KEY ?? "";
  if (!apiKey) return false;
  const expected = md5(
    params.merchantCode + params.amount + params.merchantOrderId + apiKey
  );
  return expected.toLowerCase() === (params.signature ?? "").toLowerCase();
}
