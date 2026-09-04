/**
 * Bentuk data yang dikembalikan alur split & transaksi pembayaran.
 *
 * Terpisah dari split-actions.ts karena berkas itu bertanda "use server", dan
 * Next.js melarangnya mengekspor apa pun selain fungsi async — tipe sekalipun.
 * Pola yang sama dipakai order-types.ts.
 */

import type { PaymentStatus, PaymentMethod, SplitMode } from "@/types/db";

export interface SplitBatchMemberResult {
  memberId: string;
  displayName: string;
  paymentId: string | null;
  amount: number;
  status: PaymentStatus | "skipped" | "error";
  qrString: string | null;
  expiresAt: string | null;
  /**
   * Referensi dari gateway (mis. Duitku). Dipakai layar QR untuk menampilkan
   * "Reference: DS327..." alih-alih UUID internal kita — nomor inilah yang
   * bisa ditelusuri tamu & kasir di sisi gateway. NULL kalau gateway tak
   * memberi (atau pembayaran dibuat tanpa gateway, mis. pay-at-cashier).
   */
  externalRef: string | null;
  /** Alasan skip/error (mis. sudah punya pending, atau gateway gagal). */
  note?: string;
}

export interface SessionPaymentDetail {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: string;
  splitMode: SplitMode;
  isDownPayment: boolean;
  createdAt: string;
  paidAt: string | null;
  paidByName: string;
  /** Item yang dicakup (hanya itemized). Kosong utk DP/equal/treat. */
  items: { name: string; quantity: number; amount: number }[];
  /** Subtotal item (Σ items.amount). */
  itemsSubtotal: number;
  /** Tax & service atas transaksi ini = amount − itemsSubtotal (≥ 0). */
  taxService: number;
  /** Label charge sesuai komponen aktif. */
  chargeLabel: string;
  /** QR string — HANYA diisi utk pemilik payment atau staff. */
  qrString: string | null;
  expiresAt: string | null;
  /** Bila transaksi bagian dari split batch: ringkasan status tiap anggota
   *  (nama + nominal + status). Kosong utk non-batch. */
  batchMembers: { name: string; amount: number; status: string }[];
}
