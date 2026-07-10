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
 * Round time ke slot terdekat ke belakang (floor) — pakai jam/menit LOKAL.
 * Example: slot 60 mnt, 14:46 → 14:00. Dipakai untuk slot "sedang berjalan".
 */
export function roundDownToSlot(date: Date, slotMinutes: number): Date {
  const d = new Date(date);
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();
  const floored = Math.floor(minuteOfDay / slotMinutes) * slotMinutes;
  d.setHours(Math.floor(floored / 60), floored % 60, 0, 0);
  return d;
}

/**
 * Slot mulai paling awal yang ditampilkan.
 * - minLeadTime > 0: ceil(now + lead) — booking minimal sekian menit ke depan.
 * - minLeadTime = 0: floor(now) ke slot — slot yang SEDANG berjalan masih
 *   boleh dipilih (mis. jam 14:46 → slot 14:00 tetap tampil). Slot yang sudah
 *   benar-benar lewat (mis. 13:00) tidak tampil.
 */
export function getNextValidSlot(
  now: Date,
  slotMinutes: number,
  minLeadTimeMinutes: number
): Date {
  if (minLeadTimeMinutes <= 0) {
    return roundDownToSlot(now, slotMinutes);
  }
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

  if (!dayHours || !dayHours.open || !dayHours.close) {
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
    // Wrap: tutup setelah tengah malam (mis. buka 13:00, tutup 03:00).
    // Buka kalau: minuteOfDay >= open (sore-malam) ATAU minuteOfDay < close
    // (dini hari, masih sesi hari sebelumnya).
    if (minuteOfDay >= openMin || minuteOfDay < closeMin) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `Bar buka mulai ${dayHours.open}`,
    };
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

  // 1. Tidak past. Kalau lead time 0, slot yang SEDANG berjalan masih boleh
  //    (floor now ke slot), jadi jam 14:46 boleh pilih slot 14:00.
  const earliestAllowed =
    config.minLeadTimeMinutes <= 0
      ? roundDownToSlot(now, config.slotIntervalMinutes).getTime()
      : now.getTime();
  if (reservationAt.getTime() < earliestAllowed) {
    return { ok: false, reason: "Waktu reservasi sudah lewat" };
  }

  // 2. Min lead time (hanya kalau > 0)
  if (config.minLeadTimeMinutes > 0) {
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
 * Group key "sesi malam operasi" untuk sebuah slot. Kalau bar tutup lewat
 * tengah malam (wrap) dan slot ini jatuh di bagian dini hari (minute < close &
 * < open), slot itu masuk grup MALAM SEBELUMNYA (tanggal - 1) — supaya slot
 * dini hari tampil menyambung malam pembukaannya, bukan jadi tanggal terpisah.
 * Selain itu, group key = tanggal kalender biasa.
 */
function operatingNightGroupKey(
  date: Date,
  hours: OperatingHours,
  now: Date
): string {
  const dayHours = hours[getDayKey(date)];
  if (dayHours && !dayHours.closed && dayHours.open && dayHours.close) {
    const openMin = timeToMinutes(dayHours.open);
    const closeMin =
      dayHours.close === "00:00" ? 24 * 60 : timeToMinutes(dayHours.close);
    const minuteOfDay = date.getHours() * 60 + date.getMinutes();
    // Wrap + slot dini hari → attribute ke malam kemarin.
    if (closeMin <= openMin && minuteOfDay < closeMin && minuteOfDay < openMin) {
      const prev = new Date(date);
      prev.setDate(prev.getDate() - 1);
      return formatGroupKey(prev, now);
    }
  }
  return formatGroupKey(date, now);
}

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
    // Grouping by SESI MALAM OPERASI: slot dini hari (mis. 01:00) di bar yg
    // tutup lewat tengah malam masuk grup MALAM PEMBUKAAN-nya (tgl sebelumnya),
    // bukan tanggal kalendernya — supaya booking lintas hari tampil kontinu
    // sbg satu daftar & bisa dipilih berurutan.
    slots.push({
      iso: candidate.toISOString(),
      label: formatSlotLabel(candidate, now),
      groupKey: operatingNightGroupKey(candidate, hours, now),
    });
    count++;
  }
  return slots;
}

// ============================================================
// TIME RANGE + OVERLAP
// ============================================================

/** Rentang reservasi yang sudah ada di sebuah meja (ms epoch). */
export interface BookedRange {
  startMs: number;
  endMs: number;
}

/**
 * Cek apakah dua rentang [aStart, aEnd) dan [bStart, bEnd) tumpang tindih.
 * Half-open: reservasi yang selesai tepat saat yang lain mulai TIDAK overlap
 * (17:00 selesai → 17:00 boleh mulai).
 */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Validasi rentang reservasi (mulai + selesai) terhadap config, jam operasi,
 * dan daftar reservasi existing di meja (cek bentrok).
 *
 * Cek mulai pakai validateReservationTime (past/lead/window/slot/jam buka),
 * lalu tambahan:
 * - selesai harus setelah mulai (minimal 1 slot)
 * - selesai align dengan slot
 * - selesai masih dalam jam operasi
 * - tidak overlap dengan reservasi existing di meja yang sama
 */
export function validateReservationRange(
  startAt: Date,
  endAt: Date,
  now: Date,
  config: ReservationConfig,
  hours: OperatingHours,
  existing: BookedRange[] = []
): ValidateReservationResult {
  // 1. Validasi titik mulai (reuse logic existing)
  const startCheck = validateReservationTime(startAt, now, config, hours);
  if (!startCheck.ok) return startCheck;

  // 2. Selesai valid + setelah mulai
  if (Number.isNaN(endAt.getTime())) {
    return { ok: false, reason: "Waktu selesai tidak valid" };
  }
  if (endAt.getTime() <= startAt.getTime()) {
    return { ok: false, reason: "Waktu selesai harus setelah waktu mulai" };
  }

  // 3. Selesai align dengan slot
  if (!isAlignedWithSlot(endAt, config.slotIntervalMinutes)) {
    return {
      ok: false,
      reason: `Waktu selesai harus per ${config.slotIntervalMinutes} menit`,
    };
  }

  // 4. Selesai masih dalam jam operasi (jam tutup di-treat inklusif:
  //    boleh selesai TEPAT di jam tutup). Kita cek 1 menit sebelum supaya
  //    isWithinOperatingHours (yang exclusive di close) tetap lolos.
  const justBeforeEnd = new Date(endAt.getTime() - 60 * 1000);
  const opEnd = isWithinOperatingHours(justBeforeEnd, hours);
  if (!opEnd.ok) {
    return { ok: false, reason: "Waktu selesai di luar jam operasi" };
  }

  // 5. Cek bentrok dengan reservasi existing
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();
  for (const r of existing) {
    if (rangesOverlap(startMs, endMs, r.startMs, r.endMs)) {
      return {
        ok: false,
        reason: "Slot waktu ini bentrok dengan reservasi lain",
      };
    }
  }

  return { ok: true };
}

/**
 * Dari daftar reservasi existing, tandai slot mana saja yang sudah ke-booking.
 * Sebuah slot dianggap "booked" kalau jatuh di dalam rentang reservasi mana pun
 * (start <= slot < end). Dipakai UI untuk disable slot.
 *
 * Return: Set of ISO string slot yang booked.
 */
export function getBookedSlotIsos(
  slots: AvailableSlot[],
  existing: BookedRange[]
): Set<string> {
  const booked = new Set<string>();
  for (const slot of slots) {
    const slotMs = new Date(slot.iso).getTime();
    for (const r of existing) {
      if (slotMs >= r.startMs && slotMs < r.endMs) {
        booked.add(slot.iso);
        break;
      }
    }
  }
  return booked;
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

