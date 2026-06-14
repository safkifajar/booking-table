import "server-only";

/**
 * Helper functions untuk reservation booking.
 *
 * Validation logic untuk:
 * - Slot interval (mis. cuma 14:00, 14:30 kalau 30 mnt)
 * - Min lead time (mis. booking minimal 1 jam sebelum)
 * - Booking window (mis. max 7 hari ke depan)
 * - Operating hours per hari
 * - DP calculation (% dari total order)
 *
 * Semua time handling pakai timezone Asia/Jakarta (UTC+7). User input dari
 * datetime-local field di browser udah local time, jadi gak perlu convert.
 */

import type {
  DayHours,
  DayKey,
  OperatingHours,
  ReservationConfig,
} from "./settings-constants";
import { DAY_KEYS } from "./settings-constants";
import {
  formatGroupKey,
  formatSlotLabel,
  type AvailableSlot,
} from "./reservation-format";

// Re-export client-safe format helpers + tipe supaya server punya satu pintu.
export {
  formatGroupKey,
  formatGroupLabel,
  formatSlotLabel,
  isSameDay,
  type AvailableSlot,
} from "./reservation-format";

// ============================================================
// SLOT ROUNDING
// ============================================================

/**
 * Round time ke slot terdekat ke depan (ceil).
 *
 * Example: slotMinutes=30
 *   13:14 → 13:30
 *   13:30 → 13:30
 *   13:31 → 14:00
 */
export function roundUpToSlot(date: Date, slotMinutes: number): Date {
  const ms = date.getTime();
  const slotMs = slotMinutes * 60 * 1000;
  return new Date(Math.ceil(ms / slotMs) * slotMs);
}

/**
 * Cek apakah timestamp align dengan slot interval.
 * Tolerate detik+ms (saat user pilih dari dropdown, biasanya udah clean).
 */
export function isAlignedWithSlot(date: Date, slotMinutes: number): boolean {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes % slotMinutes === 0 && date.getSeconds() === 0;
}

/**
 * Slot terdekat dari sekarang yang valid (memenuhi min lead time).
 * Default: ceil to next slot + add lead time.
 */
export function getNextValidSlot(
  now: Date,
  slotMinutes: number,
  minLeadTimeMinutes: number
): Date {
  const earliest = new Date(now.getTime() + minLeadTimeMinutes * 60 * 1000);
  return roundUpToSlot(earliest, slotMinutes);
}

// ============================================================
// OPERATING HOURS
// ============================================================

const DAY_INDEX_TO_KEY: DayKey[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

export function getDayKey(date: Date): DayKey {
  return DAY_INDEX_TO_KEY[date.getDay()];
}

/**
 * Parse "HH:MM" → minutes since 00:00. "23:30" → 1410.
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Cek apakah reservasi jatuh di dalam operating hours hari itu.
 *
 * Edge case: jam tutup setelah tengah malam (mis. open 18:00, close 02:00)
 * → close < open → "wraps to next day". Reservasi sebelum 02:00 dianggap
 * masih bagian dari hari sebelumnya. Untuk MVP, kita treat close=00:00 sebagai
 * "tutup tengah malam" (= 24:00, sah). close<open di luar 00:00 tidak supported
 * (display warning di settings nanti, tapi gak crash).
 */
export function isWithinOperatingHours(
  date: Date,
  hours: OperatingHours
): { ok: boolean; reason?: string } {
  const dayKey = getDayKey(date);
  const dayHours = hours[dayKey];

  if (!dayHours) {
    return { ok: false, reason: "Operating hours tidak terdefinisi" };
  }
  if (dayHours.closed) {
    return { ok: false, reason: "Bar tutup di hari ini" };
  }

  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const openMin = timeToMinutes(dayHours.open);
  // "00:00" close = 24:00 (tengah malam), edge case
  const closeMin = dayHours.close === "00:00" ? 24 * 60 : timeToMinutes(dayHours.close);

  if (closeMin <= openMin) {
    // Wrap: close < open (mis. 18:00 - 02:00). Untuk simplicity: tetap allow
    // hanya kalau minuteOfDay >= openMin (selalu hari ini, gak ke besok).
    if (minuteOfDay < openMin) {
      return {
        ok: false,
        reason: `Bar buka mulai ${dayHours.open}`,
      };
    }
    return { ok: true };
  }

  if (minuteOfDay < openMin) {
    return { ok: false, reason: `Bar buka mulai ${dayHours.open}` };
  }
  if (minuteOfDay >= closeMin) {
    return { ok: false, reason: `Bar tutup jam ${dayHours.close}` };
  }
  return { ok: true };
}

// ============================================================
// FULL VALIDATION
// ============================================================

export interface ValidateReservationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate reservation time terhadap config + operating hours.
 *
 * Cek:
 * - Timestamp di masa depan (tidak past)
 * - Min lead time terpenuhi
 * - Booking window (max H+N hari)
 * - Slot interval alignment
 * - Operating hours hari itu
 */
export function validateReservationTime(
  reservationAt: Date,
  now: Date,
  config: ReservationConfig,
  hours: OperatingHours
): ValidateReservationResult {
  if (Number.isNaN(reservationAt.getTime())) {
    return { ok: false, reason: "Waktu reservasi tidak valid" };
  }

  // 1. Tidak past
  if (reservationAt.getTime() < now.getTime()) {
    return { ok: false, reason: "Waktu reservasi sudah lewat" };
  }

  // 2. Min lead time
  const minLeadMs = config.minLeadTimeMinutes * 60 * 1000;
  if (reservationAt.getTime() < now.getTime() + minLeadMs) {
    const mins = config.minLeadTimeMinutes;
    const hint =
      mins >= 60 ? `${Math.round(mins / 60)} jam` : `${mins} menit`;
    return {
      ok: false,
      reason: `Reservasi minimal ${hint} sebelum waktu booking`,
    };
  }

  // 3. Booking window
  const maxMs = config.bookingWindowDays * 24 * 60 * 60 * 1000;
  if (reservationAt.getTime() > now.getTime() + maxMs) {
    return {
      ok: false,
      reason: `Reservasi maksimal ${config.bookingWindowDays} hari ke depan`,
    };
  }

  // 4. Slot interval alignment
  if (!isAlignedWithSlot(reservationAt, config.slotIntervalMinutes)) {
    return {
      ok: false,
      reason: `Pilih slot waktu yang valid (per ${config.slotIntervalMinutes} menit)`,
    };
  }

  // 5. Operating hours
  const op = isWithinOperatingHours(reservationAt, hours);
  if (!op.ok) {
    return { ok: false, reason: op.reason };
  }

  return { ok: true };
}

// ============================================================
// AVAILABLE SLOTS GENERATOR (untuk UI dropdown)
// ============================================================

/**
 * Generate semua slot available dari now sampai max booking window.
 * Skip yang gak match operating hours / lead time.
 *
 * Untuk UI dropdown — biarkan customer pilih dari list yang valid.
 */
export function generateAvailableSlots(
  now: Date,
  config: ReservationConfig,
  hours: OperatingHours
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const start = getNextValidSlot(
    now,
    config.slotIntervalMinutes,
    config.minLeadTimeMinutes
  );
  const endMs = now.getTime() + config.bookingWindowDays * 24 * 60 * 60 * 1000;

  const slotMs = config.slotIntervalMinutes * 60 * 1000;
  // Hard cap supaya gak generate ribuan slot (mis. 1 menit slot * 30 hari)
  const MAX_SLOTS = 500;

  let count = 0;
  for (let t = start.getTime(); t <= endMs && count < MAX_SLOTS; t += slotMs) {
    const candidate = new Date(t);
    const op = isWithinOperatingHours(candidate, hours);
    if (!op.ok) continue;
    slots.push({
      iso: candidate.toISOString(),
      label: formatSlotLabel(candidate, now),
      groupKey: formatGroupKey(candidate, now),
    });
    count++;
  }
  return slots;
}

// ============================================================
// DP CALCULATION
// ============================================================

/**
 * Hitung DP (Rupiah) dari total order dan persentase config.
 * Round up ke 100 rupiah supaya nominal cantik.
 */
export function calculateDP(
  totalOrder: number,
  minDownPaymentPercent: number
): number {
  if (minDownPaymentPercent <= 0) return 0;
  const raw = (totalOrder * minDownPaymentPercent) / 100;
  return Math.ceil(raw / 100) * 100;
}

// Suppress unused import warnings — both di-import untuk type-narrowing context
void DAY_KEYS;
void (null as unknown as DayHours);

