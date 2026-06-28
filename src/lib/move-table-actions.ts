"use server";

import { z } from "zod";
import { and, asc, eq, ne, sql, inArray, isNotNull, lt, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { requireProfile } from "@/lib/auth-v2/current";
import { isDbConstraintError } from "@/lib/utils";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";

/**
 * Pindah meja — FASE 1.
 *
 * Aturan fase ini:
 * - Hanya untuk sesi berstatus 'reserved' (belum masuk jam booking) → pindah
 *   LANGSUNG tanpa approval, oleh HOST sesi.
 * - Status aktif (open/locked) → DITOLAK di fase ini (akan butuh approval di
 *   fase berikutnya).
 *
 * Teknis: ganti table_id sesi. Waktu reservasi (reservation_at/end) dibiarkan
 * sama → durasi otomatis identik. Constraint DB no_overlapping_reservation
 * menjaga meja tujuan tak bentrok.
 */

export interface MoveTargetTable {
  id: string;
  label: string;
  area_name: string;
  capacity: number;
  min_spend: number;
}

/**
 * Daftar meja tujuan yg valid untuk dipindahi sesi ini: aktif, di bar sama,
 * bukan meja sekarang, kapasitas cukup, dan slot waktu (rentang reservasi sesi)
 * TIDAK bentrok dgn sesi reserved/open/locked lain.
 */
export async function getMoveTargets(
  sessionId: string
): Promise<MoveTargetTable[]> {
  const profile = await requireProfile();

  const [session] = await db
    .select({
      id: tableSessions.id,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));
  if (!session || session.hostId !== profile.id) return [];

  // Jumlah anggota (utk filter kapasitas).
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, session.id),
        ne(sessionMembers.status, "pending")
      )
    );

  // Meja yg slot waktunya bentrok dgn rentang sesi ini (reserved/open/locked).
  const start = session.reservationAt;
  const end = session.reservationEndAt;
  const busyTableIds = new Set<string>();
  if (start && end) {
    const overlapping = await db
      .select({ tableId: tableSessions.tableId })
      .from(tableSessions)
      .where(
        and(
          inArray(tableSessions.status, ["reserved", "open", "locked"]),
          ne(tableSessions.id, session.id),
          isNotNull(tableSessions.reservationAt),
          isNotNull(tableSessions.reservationEndAt),
          // overlap: other.start < end AND other.end > start
          lt(tableSessions.reservationAt, end),
          gt(tableSessions.reservationEndAt, start)
        )
      );
    for (const r of overlapping) busyTableIds.add(r.tableId);
  }

  const rows = await db
    .select({
      id: tables.id,
      label: tables.label,
      area_name: floorAreas.name,
      capacity: tables.capacity,
      min_spend: tables.minSpend,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(
      and(
        eq(floorAreas.barId, session.barId),
        eq(tables.isActive, true),
        ne(tables.id, session.tableId)
      )
    )
    .orderBy(asc(floorAreas.sortOrder), asc(tables.label));

  return rows
    .filter((r) => !busyTableIds.has(r.id) && r.capacity >= cnt)
    .map((r) => ({
      id: r.id,
      label: r.label,
      area_name: r.area_name,
      capacity: r.capacity,
      min_spend: r.min_spend ?? 0,
    }));
}

const moveSchema = z.object({
  sessionId: z.string().uuid(),
  targetTableId: z.string().uuid(),
});

export async function moveTable(input: z.infer<typeof moveSchema>) {
  const profile = await requireProfile();
  const data = moveSchema.parse(input);

  // 1. Ambil sesi + meja asal (+ bar).
  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      hostId: tableSessions.hostId,
      tableId: tableSessions.tableId,
      reservationAt: tableSessions.reservationAt,
      reservationEndAt: tableSessions.reservationEndAt,
      barId: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, data.sessionId));

  if (!session) throw new Error("Sesi tidak ditemukan");
  if (session.hostId !== profile.id) {
    throw new Error("Hanya host meja yang bisa pindah meja");
  }
  if (session.tableId === data.targetTableId) {
    throw new Error("Meja tujuan sama dengan meja sekarang");
  }

  // 2. Fase 1: hanya status 'reserved' yg boleh pindah mandiri.
  if (session.status !== "reserved") {
    throw new Error(
      "Meja sudah aktif. Pindah meja saat aktif butuh persetujuan staff (segera hadir)."
    );
  }

  // 3. Validasi meja tujuan: aktif, di bar yg sama, kapasitas cukup.
  const [target] = await db
    .select({
      id: tables.id,
      label: tables.label,
      capacity: tables.capacity,
      isActive: tables.isActive,
      barId: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, data.targetTableId));

  if (!target) throw new Error("Meja tujuan tidak ditemukan");
  if (!target.isActive) throw new Error("Meja tujuan tidak aktif");
  if (target.barId !== session.barId) {
    throw new Error("Meja tujuan beda bar");
  }

  // Kapasitas: jumlah anggota joined/left harus muat.
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, session.id),
        ne(sessionMembers.status, "pending")
      )
    );
  if (cnt > target.capacity) {
    throw new Error(
      `Kapasitas meja ${target.label} (${target.capacity}) tak cukup untuk ${cnt} tamu.`
    );
  }

  // 4. Eksekusi: ganti table_id (waktu tetap → durasi sama). Constraint DB
  //    menolak kalau slot meja tujuan bentrok.
  try {
    await db
      .update(tableSessions)
      .set({ tableId: data.targetTableId })
      .where(eq(tableSessions.id, session.id));
  } catch (err) {
    if (isDbConstraintError(err, "no_overlapping_reservation")) {
      throw new Error(
        `Slot waktu di meja ${target.label} sudah dibooking. Pilih meja lain.`
      );
    }
    if (isDbConstraintError(err, "uq_active_session_per_table")) {
      throw new Error(`Meja ${target.label} sedang dipakai.`);
    }
    throw err;
  }

  // 5. Realtime: meja lama & baru berubah → refresh floor/sesi.
  await Promise.allSettled([
    notify(channels.session(session.id)),
    notify(channels.bar(session.barId)),
    notify(channels.staff(session.barId)),
  ]);

  revalidatePath(`/session/${session.id}`);
  revalidatePath("/bar/[slug]", "page");
}
