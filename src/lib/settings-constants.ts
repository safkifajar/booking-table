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
  mon: "Senin",
  tue: "Selasa",
  wed: "Rabu",
  thu: "Kamis",
  fri: "Jumat",
  sat: "Sabtu",
  sun: "Minggu",
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
   * Minimum DP (Rp) yang harus dibayar saat reservasi.
   * 0 = no DP required, customer cuma commit order tanpa bayar.
   */
  minDownPaymentAmount: number;
}

export interface BarSettings {
  operatingHours: OperatingHours;
  reservationConfig: ReservationConfig;
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
  minDownPaymentAmount: 0,
};
