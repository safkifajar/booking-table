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
}

/** Cara pembulatan nilai tax/service (rupiah tak berdesimal). */
export type RoundingMode = "none" | "up" | "down";

export interface ChargeConfig {
  /** Pajak (%) dari subtotal. 0 = tidak dikenakan. */
  taxPercent: number;
  /** Service charge (%) dari subtotal. 0 = tidak dikenakan. */
  servicePercent: number;
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
};

export const DEFAULT_CHARGE_CONFIG: ChargeConfig = {
  taxPercent: 0,
  servicePercent: 0,
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
  /** Persen gabungan (taxPercent + servicePercent) untuk label "(15%)". */
  chargePercent: number;
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
  const tax =
    c.taxPercent > 0 ? roundCharge((sub * c.taxPercent) / 100, c.rounding) : 0;
  const service =
    c.servicePercent > 0
      ? roundCharge((sub * c.servicePercent) / 100, c.rounding)
      : 0;
  return {
    subtotal: sub,
    tax,
    service,
    charge: tax + service,
    chargePercent: c.taxPercent + c.servicePercent,
    total: sub + tax + service,
  };
}
