/**
 * Bentuk data yang dikembalikan pembacaan pesanan.
 *
 * Terpisah dari order-actions.ts karena berkas itu bertanda "use server",
 * dan Next.js melarangnya mengekspor apa pun selain fungsi async — tipe
 * sekalipun. Sebelumnya kedua tipe ini menumpang di actions.ts, yang lolos
 * hanya karena tak pernah benar-benar diekspor lewat batas "use server".
 */

export interface SessionOrderSummary {
  id: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  itemCount: number;
  subtotal: number;
  total: number;
  outstanding: number;
  /** NULL = order MEJA (host/staff). Terisi = order milik seorang anggota. */
  owner_member_id: string | null;
  /** Nama pemesan: pemilik order, atau host utk order meja. */
  ordered_by: string | null;
  /** Batas waktu (ISO) pembayaran "pay at cashier" yg masih pending utk order
   *  ini. Terisi → tampilkan badge "Pay at cashier" + countdown, klik order →
   *  halaman /order/[id]/pay. NULL = tak ada pending pay-at-cashier. */
  cashier_pending_expires_at: string | null;
}

export interface OrderDetail {
  id: string;
  sessionId: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  subtotal: number;
  charge: number;
  chargePercent: number;
  /** Label charge sesuai komponen aktif ("Tax & Service"/"Tax"/"Service charge"). */
  chargeLabel: string;
  total: number;
  paid: number;
  outstanding: number;
  isHost: boolean;
  isStaff: boolean;
  /** Pemanggil kasir (staff role cashier) — utk opsi bayar cash/mark-paid. */
  isCashier: boolean;
  /** Boleh membuat pembayaran utk order ini (host/staff & masih ada sisa). */
  canPay: boolean;
  /** View-only: penonton non-member — nominal/pemesan/pembayaran di-redaksi. */
  viewOnly: boolean;
  /** Anggota joined (id + nama) — utk kasir pilih payer saat terima cash.
   *  is_guest = tamu walk-in tanpa akun → tak punya voucher. */
  members: { id: string; name: string; is_guest: boolean }[];
  items: {
    id: string;
    name: string;
    /** Foto menu (null kalau item tak punya gambar). */
    image_url: string | null;
    quantity: number;
    unit_price: number;
    added_by: string | null;
  }[];
  payments: {
    id: string;
    amount: number;
    method: string;
    status: string;
    split_mode: string;
    is_down_payment: boolean;
    /** "Pay at cashier": pending menunggu konfirmasi kasir (tanpa QR). */
    pay_at_cashier: boolean;
    /** Digantikan pembayaran lain yang menutup tagihan (bukan batal biasa). */
    superseded: boolean;
    created_at: string;
    paid_at: string | null;
    paid_by: string;
    paid_by_avatar: string | null;
    paid_by_member_id: string;
    /** true kalau pembayar adalah HOST meja → badge "host". */
    paid_by_is_host: boolean;
    /** Nama kasir yang memproses (pay-at-cashier). null = bukan/ belum. */
    confirmed_by: string | null;
    qr_string: string | null;
    /** Reference gateway (Duitku) — utk melacak transaksi di dashboard
     *  gateway. Beda dari id payment kita. */
    external_ref: string | null;
    expires_at: string | null;
  }[];
  /** Anggota joined (utk split di PaymentSheet). */
  membersCount: number;
  myMemberId: string | null;
  /**
   * Order ini milik si penonton (anggota memesan untuk dirinya sendiri).
   * true → bayar PENUH tanpa split (split equally & treat hanya utk order meja
   * yang dipegang host).
   */
  isOwnOrder: boolean;
  /** Nama pemesan: pemilik order (anggota), atau host utk order MEJA. */
  ordered_by: string | null;
  /** Order ini milik seorang ANGGOTA (bukan order meja) — siapa pun pemiliknya. */
  isMemberOrder: boolean;
}
