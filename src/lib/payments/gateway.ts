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
}

export interface PaymentGateway {
  /**
   * Buat charge baru di gateway.
   * Caller: Server Action setelah insert row payments dengan status=pending.
   */
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;

  /**
   * Cek status payment di gateway.
   * Dipakai untuk polling (saat customer scan QRIS) atau verifikasi.
   */
  checkStatus(externalRef: string): Promise<PaymentStatus>;
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

  async checkStatus(externalRef: string): Promise<PaymentStatus> {
    // Mock: kalau ref start dengan "mock_", anggap paid
    if (externalRef.startsWith("mock_")) return "paid";
    return "pending";
  },
};

// ============================================================
// GATEWAY SELECTOR
// ============================================================

const driver = process.env.PAYMENT_GATEWAY ?? "mock";

export function getPaymentGateway(): PaymentGateway {
  if (driver === "mock") return mockGateway;

  throw new Error(
    `Unknown PAYMENT_GATEWAY: ${driver}. Supported: mock (xendit/midtrans coming soon)`
  );
}
