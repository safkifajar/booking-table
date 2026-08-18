"use server";

/**
 * Server Actions untuk Bar Settings (operating hours + reservation config).
 *
 * Stored di bars.opening_hours & bars.reservation_config (JSONB).
 *
 * Akses: admin/manager only.
 *
 * Constants & types di-export dari ./settings-constants karena "use server"
 * file cuma boleh export async functions.
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile } from "@/lib/auth-v2/current";
import {
  DAY_KEYS,
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  DEFAULT_CHARGE_CONFIG,
  type BarSettings,
  type ChargeConfig,
  type DayHours,
  type DayKey,
  type OperatingHours,
  type ReservationConfig,
} from "./settings-constants";
import { normalizeWaNumber } from "./contact";

// ============================================================
// ADMIN GUARD
// ============================================================

async function requireAdminForBar(barId: string) {
  const profile = await requireProfile();
  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profile.id),
        eq(staffRoles.barId, barId),
        eq(staffRoles.isActive, true)
      )
    );
  if (!staff) throw new Error("Admin access required");
  if (staff.role !== "admin" && staff.role !== "manager") {
    throw new Error("Only admin/manager can edit settings");
  }
  return { profile, role: staff.role };
}

// ============================================================
// READ
// ============================================================

export async function getBarSettings(barId: string): Promise<BarSettings> {
  await requireAdminForBar(barId);

  const [row] = await db
    .select({
      openingHours: bars.openingHours,
      reservationConfig: bars.reservationConfig,
      chargeConfig: bars.chargeConfig,
    })
    .from(bars)
    .where(eq(bars.id, barId));

  if (!row) throw new Error("Bar not found");

  // Deep merge per-day: kalau DB cuma punya { open, close } tanpa `closed`,
  // tetap pakai default `closed=false`. Top-level spread bisa overwrite per
  // day jadi partial.
  const dbHours = (row.openingHours as Partial<OperatingHours>) ?? {};
  const operatingHours: OperatingHours = {};
  for (const day of DAY_KEYS) {
    const def = DEFAULT_OPERATING_HOURS[day]!;
    const stored = dbHours[day] as Partial<DayHours> | undefined;
    operatingHours[day] = {
      open: stored?.open ?? def.open,
      close: stored?.close ?? def.close,
      closed:
        typeof stored?.closed === "boolean" ? stored.closed : def.closed,
    };
  }

  const reservationConfig = {
    ...DEFAULT_RESERVATION_CONFIG,
    ...((row.reservationConfig as Partial<ReservationConfig>) ?? {}),
  };

  const chargeConfig = {
    ...DEFAULT_CHARGE_CONFIG,
    ...((row.chargeConfig as Partial<ChargeConfig>) ?? {}),
  };

  return { operatingHours, reservationConfig, chargeConfig };
}

/**
 * Baca chargeConfig SAJA — dipakai jalur pembayaran (cashier/payShare/receipt)
 * yang butuh tax/service TANPA guard admin (dipanggil dari server actions
 * staff/customer). Tak ada requireAdmin di sini.
 */
export async function getChargeConfig(barId: string): Promise<ChargeConfig> {
  const [row] = await db
    .select({ chargeConfig: bars.chargeConfig })
    .from(bars)
    .where(eq(bars.id, barId));
  return {
    ...DEFAULT_CHARGE_CONFIG,
    ...((row?.chargeConfig as Partial<ChargeConfig>) ?? {}),
  };
}

// ============================================================
// UPDATE OPERATING HOURS
// ============================================================

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const dayHoursSchema = z.object({
  open: z.string().regex(TIME_REGEX, "Time must be HH:MM (24-hour)"),
  close: z.string().regex(TIME_REGEX, "Time must be HH:MM (24-hour)"),
  closed: z.boolean(),
});

const operatingHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

export async function updateOperatingHours(
  barId: string,
  hours: OperatingHours
): Promise<void> {
  await requireAdminForBar(barId);

  // Coerce undefined `closed` → false (defense kalau client kirim partial)
  const sanitized: Record<DayKey, DayHours> = {} as Record<DayKey, DayHours>;
  for (const day of DAY_KEYS) {
    const v = (hours[day] ?? {}) as Partial<DayHours>;
    sanitized[day] = {
      open: v.open ?? "10:00",
      close: v.close ?? "23:00",
      closed: typeof v.closed === "boolean" ? v.closed : false,
    };
  }
  const parsed = operatingHoursSchema.parse(sanitized);

  await db
    .update(bars)
    .set({ openingHours: parsed })
    .where(eq(bars.id, barId));

  revalidatePath("/admin/settings");
  revalidatePath("/bar/[slug]", "page");
}

// ============================================================
// UPDATE RESERVATION CONFIG
// ============================================================

const reservationConfigSchema = z.object({
  enabled: z.boolean(),
  bookingWindowDays: z.number().int().min(1).max(30),
  minLeadTimeMinutes: z.number().int().min(0).max(1440),
  slotIntervalMinutes: z.union([
    z.literal(15),
    z.literal(30),
    z.literal(60),
    z.literal(120),
  ]),
  minDownPaymentPercent: z.number().int().min(0).max(100),
  // 0 = pengingat dimatikan. Batas 1440 menit (24 jam) — lebih awal dari itu
  // tak berguna sebagai "sebentar lagi".
  reminderMinutesBefore: z.number().int().min(0).max(1440),
});

export async function updateReservationConfig(
  barId: string,
  config: ReservationConfig
): Promise<void> {
  await requireAdminForBar(barId);
  const parsed = reservationConfigSchema.parse(config);

  await db
    .update(bars)
    .set({ reservationConfig: parsed })
    .where(eq(bars.id, barId));

  revalidatePath("/admin/settings");
}

// ============================================================
// UPDATE CHARGE CONFIG (tax & service)
// ============================================================

const chargeConfigSchema = z.object({
  taxPercent: z.number().min(0).max(100),
  servicePercent: z.number().min(0).max(100),
  // Toggle per komponen (nilai % tetap tersimpan saat nonaktif).
  taxEnabled: z.boolean(),
  serviceEnabled: z.boolean(),
  rounding: z.enum(["none", "up", "down"]),
});

export async function updateChargeConfig(
  barId: string,
  config: ChargeConfig
): Promise<void> {
  await requireAdminForBar(barId);
  const parsed = chargeConfigSchema.parse(config);

  await db.update(bars).set({ chargeConfig: parsed }).where(eq(bars.id, barId));

  // Tax/service memengaruhi tagihan di banyak tempat → revalidate luas.
  revalidatePath("/admin/settings");
  revalidatePath("/staff/cashier");
}

// ============================================================
// KONTAK CS (nomor WhatsApp)
// ============================================================

/**
 * Nomor WhatsApp CS bar. TANPA guard — nomor ini memang publik (tombol
 * "Contact us" di /auth & /profile), dan halaman-halaman itu diakses
 * sebelum login.
 *
 * Dipakai halaman SERVER lalu dialirkan lewat props ke komponen client,
 * karena komponen client tak bisa membaca DB.
 *
 * Return null kalau admin belum mengisi → pemanggil pakai fallback
 * (lihat resolveWa di lib/contact.ts).
 */
export async function getBarContactWa(): Promise<string | null> {
  const [row] = await db
    .select({ wa: bars.contactWa })
    .from(bars)
    .orderBy(asc(bars.createdAt))
    .limit(1);
  return row?.wa ?? null;
}

const contactSchema = z.object({
  contactWa: z.string().trim().max(30),
});

export async function updateBarContact(
  barId: string,
  input: z.infer<typeof contactSchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminForBar(barId);
  const data = contactSchema.parse(input);

  // Dirapikan ke format wa.me ("0812-3456" -> "628123456"). Kosong = boleh,
  // artinya kembali ke default. Tapi isian yang TAK MASUK AKAL ditolak —
  // lebih baik gagal jelas daripada tombol CS menuju nomor rusak.
  const raw = data.contactWa.trim();
  let normalized: string | null = null;
  if (raw) {
    normalized = normalizeWaNumber(raw);
    if (!normalized) {
      return {
        ok: false,
        error: "That doesn't look like a valid WhatsApp number",
      };
    }
  }

  await db
    .update(bars)
    .set({ contactWa: normalized })
    .where(eq(bars.id, barId));

  // Nomor dipakai di /auth, /profile, & halaman link → revalidate luas.
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  revalidatePath("/link");
  return { ok: true };
}
