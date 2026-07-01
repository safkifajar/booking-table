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
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile } from "@/lib/auth-v2/current";
import {
  DAY_KEYS,
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  type BarSettings,
  type DayHours,
  type DayKey,
  type OperatingHours,
  type ReservationConfig,
} from "./settings-constants";

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

  return { operatingHours, reservationConfig };
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
