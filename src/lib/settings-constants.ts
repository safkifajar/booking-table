/**
 * Constants untuk Bar Settings.
 *
 * File terpisah dari settings-actions.ts karena Next.js larang "use server"
 * file export non-function (cuma async functions).
 */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAY_KEYS: DayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export interface DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
  closed: boolean;
}

export type OperatingHours = Partial<Record<DayKey, DayHours>>;

export interface ReservationConfig {
  enabled: boolean;
  bookingWindowDays: number; // 1-30
  minLeadTimeMinutes: number; // 0-1440
  slotIntervalMinutes: 15 | 30 | 60 | 120;
  /**
   * Minimum DP sebagai persentase dari total order initial (0-100).
   * 0 = no DP required (customer cuma commit order tanpa bayar).
   * 50 = customer wajib bayar 50% dari total order saat reservasi.
   * 100 = full prepayment.
   */
  minDownPaymentPercent: number;
  /**
   * Berapa menit SEBELUM jam booking pengingat dikirim ke tamu (in-app +
   * push). 0 = fitur dimatikan.
   *
   * Contoh: 30 → tamu diingatkan 30 menit sebelum jamnya. Dikirim sekali
   * saja per reservasi (ditandai table_sessions.reminder_sent_at).
   */
  reminderMinutesBefore: number;
}

/** Cara pembulatan nilai tax/service (rupiah tak berdesimal). */
export type RoundingMode = "none" | "up" | "down";

export interface ChargeConfig {
  /** Pajak (%) dari subtotal. 0 = tidak dikenakan. */
  taxPercent: number;
  /** Service charge (%) dari subtotal. 0 = tidak dikenakan. */
  servicePercent: number;
  /**
   * Toggle aktif per komponen (nilai % tetap tersimpan saat dimatikan).
   * Config lama tanpa flag → default TRUE (merge DEFAULT) — kompatibel.
   */
  taxEnabled: boolean;
  serviceEnabled: boolean;
  /**
   * Pembulatan tiap komponen (tax & service):
   * - "none" = tanpa pembulatan (dibulatkan ke bilangan bulat terdekat)
   * - "up"   = dibulatkan ke atas (Math.ceil)
   * - "down" = dibulatkan ke bawah (Math.floor)
   */
  rounding: RoundingMode;
}

export interface BarSettings {
  operatingHours: OperatingHours;
  reservationConfig: ReservationConfig;
  chargeConfig: ChargeConfig;
}

export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  mon: { open: "10:00", close: "23:00", closed: false },
  tue: { open: "10:00", close: "23:00", closed: false },
  wed: { open: "10:00", close: "23:00", closed: false },
  thu: { open: "10:00", close: "23:00", closed: false },
  fri: { open: "10:00", close: "00:00", closed: false },
  sat: { open: "10:00", close: "00:00", closed: false },
  sun: { open: "10:00", close: "23:00", closed: false },
};

export const DEFAULT_RESERVATION_CONFIG: ReservationConfig = {
  enabled: false,
  bookingWindowDays: 7,
  minLeadTimeMinutes: 60,
  slotIntervalMinutes: 60,
  minDownPaymentPercent: 0,
  // 30 menit — cukup untuk berangkat, tak terlalu awal sampai terlupakan.
  reminderMinutesBefore: 30,
};

export const DEFAULT_CHARGE_CONFIG: ChargeConfig = {
  taxPercent: 0,
  servicePercent: 0,
  taxEnabled: true,
  serviceEnabled: true,
  rounding: "none",
};

/** Bulatkan nilai charge sesuai mode. */
function roundCharge(value: number, mode: RoundingMode): number {
  if (mode === "up") return Math.ceil(value);
  if (mode === "down") return Math.floor(value);
  return Math.round(value);
}

export interface BillTotals {
  subtotal: number;
  tax: number;
  service: number;
  /** Gabungan tax + service (ditampilkan 1 baris ke user). */
  charge: number;
  /** Persen gabungan komponen yang AKTIF untuk label "(15%)". */
  chargePercent: number;
  /**
   * Label baris charge sesuai komponen yang aktif & bernilai:
   * "Tax & Service" | "Tax" | "Service charge" | "" (tak ada charge).
   * SEMUA layar wajib memakai ini — jangan hardcode "Tax & Service".
   */
  chargeLabel: string;
  /** subtotal + tax + service (yang dibayar user). */
  total: number;
}

/**
 * SATU SUMBER KEBENARAN perhitungan tagihan. Tax & service dihitung dari
 * subtotal (bukan bertingkat), tiap komponen dibulatkan sesuai config.
 * Dipakai di SEMUA titik (outstanding, receipt, split, laporan) supaya konsisten.
 */
export function computeBillTotals(
  subtotal: number,
  cfg: ChargeConfig | null | undefined
): BillTotals {
  const c = cfg ?? DEFAULT_CHARGE_CONFIG;
  const sub = Math.max(0, Math.round(subtotal));
  // Toggle per komponen: nonaktif = 0 di perhitungan & label, nilai % tetap
  // tersimpan. Config lama tanpa flag → undefined → dianggap aktif.
  const taxPct = c.taxEnabled !== false ? c.taxPercent : 0;
  const servicePct = c.serviceEnabled !== false ? c.servicePercent : 0;
  const tax = taxPct > 0 ? roundCharge((sub * taxPct) / 100, c.rounding) : 0;
  const service =
    servicePct > 0 ? roundCharge((sub * servicePct) / 100, c.rounding) : 0;
  const chargeLabel =
    taxPct > 0 && servicePct > 0
      ? "Tax & Service"
      : taxPct > 0
        ? "Tax"
        : servicePct > 0
          ? "Service charge"
          : "";
  return {
    subtotal: sub,
    tax,
    service,
    charge: tax + service,
    chargePercent: taxPct + servicePct,
    chargeLabel,
    total: sub + tax + service,
  };
}

// ============================================================
// DP (DOWN PAYMENT)
// ============================================================

/**
 * Hitung DP (Rupiah) dari TOTAL TAGIHAN (sudah termasuk tax & service) dan
 * persentase config.
 *
 * PENTING: `grandTotal` HARUS grand total (computeBillTotals(...).total), bukan
 * subtotal item mentah. Dulu DP dihitung dari subtotal → DP 100% TIDAK melunasi
 * tagihan (sisa sebesar tax & service masih menggantung).
 *
 * - 100% → kembalikan grand total APA ADANYA (tanpa round-up), supaya benar-benar
 *   lunas & tak lebih bayar hingga Rp99.
 * - selain itu → round-up ke Rp100 (nominal cantik), tapi di-cap ke grand total.
 *
 * Ditaruh di sini (client-safe) supaya SERVER & FORM memakai rumus yang SAMA —
 * dulu rumusnya diduplikasi di OpenTableForm dan gampang melenceng.
 */
export function calculateDP(
  grandTotal: number,
  minDownPaymentPercent: number
): number {
  if (minDownPaymentPercent <= 0) return 0;
  if (minDownPaymentPercent >= 100) return Math.max(0, Math.round(grandTotal));
  const raw = (grandTotal * minDownPaymentPercent) / 100;
  const rounded = Math.ceil(raw / 100) * 100;
  return Math.min(rounded, Math.max(0, Math.round(grandTotal)));
}

// ============================================================
// LINK TREE (halaman publik link.<domain> untuk bio Instagram)
// ============================================================

/**
 * Judul/subjudul halaman + preferensi tampil untuk 3 tautan BAWAAN.
 *
 * Yang bawaan sengaja tak disimpan sebagai baris di bar_links: dirakit dari
 * data yang sudah ada (bars.address, CONTACT_WA) supaya admin tak perlu
 * mengetik ulang & tautannya ikut berubah kalau datanya berubah. Yang
 * tersimpan di sini hanya "tampilkan atau tidak".
 */
export interface LinkTreeConfig {
  /** Judul di atas daftar tautan. Kosong → pakai nama bar. */
  headline: string;
  /** Kalimat singkat di bawah judul. */
  tagline: string;
  /** Tampilkan tautan "Open the app" (ke domain customer). */
  showApp: boolean;
  /** Tampilkan tautan WhatsApp CS. */
  showWhatsapp: boolean;
  /** Tampilkan tautan alamat (buka Google Maps). */
  showAddress: boolean;
  /**
   * URL & label KUSTOM untuk tiga tautan bawaan. KOSONG = pakai nilai
   * otomatis dari data yang ada (domain app, CONTACT_WA, bars.address).
   *
   * Disediakan karena nilai otomatis tak selalu pas: Google Maps hasil
   * pencarian teks bisa salah menunjuk, dan nomor WA promo kadang beda
   * dari nomor CS.
   */
  appUrl: string;
  appLabel: string;
  whatsappUrl: string;
  whatsappLabel: string;
  addressUrl: string;
  addressLabel: string;
}

export const DEFAULT_LINK_TREE_CONFIG: LinkTreeConfig = {
  headline: "",
  tagline: "",
  showApp: true,
  showWhatsapp: true,
  showAddress: true,
  // Kosong = otomatis. Admin hanya mengisi kalau ingin menimpanya.
  appUrl: "",
  appLabel: "",
  whatsappUrl: "",
  whatsappLabel: "",
  addressUrl: "",
  addressLabel: "",
};
