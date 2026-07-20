/**
 * Otorisasi per-session (host vs staff) — sumber kebenaran tunggal.
 *
 * Dipakai bersama oleh flow pembayaran (host-only payment/QRIS) dan flow order
 * (host-only tambah order + pay-before-order). Tujuan: SATU definisi "host"
 * supaya tak ada dua logika yang bisa menyimpang.
 *
 * Sumber kebenaran host = `table_sessions.host_id` (BUKAN
 * `session_members.role='host'`). Lihat PRD §0.6.
 *
 * Server-only.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { staffRoles } from "@/lib/db/schema/extras";
import { tableSessions as sessions } from "@/lib/db/schema/sessions";

/**
 * True kalau profileId adalah host sesi (table_sessions.host_id).
 * Return false kalau sesi tak ada.
 */
export async function isSessionHost(
  sessionId: string,
  profileId: string
): Promise<boolean> {
  const [row] = await db
    .select({ hostId: sessions.hostId })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return !!row && row.hostId === profileId;
}

export interface HostOrStaffResult {
  /** True kalau pemanggil adalah host sesi. */
  isHost: boolean;
  /** Role staff aktif di bar sesi, atau null kalau bukan staff. */
  staffRole: "admin" | "manager" | "cashier" | "waiter" | null;
  /** ID bar sesi (untuk revalidate / query lanjutan). */
  barId: string;
  /** host_id sesi (untuk atribusi pembayaran ke host member, dll). */
  hostId: string;
}

/**
 * Pastikan pemanggil boleh mengoperasikan sesi ini: HOST sesi ATAU staff aktif
 * di bar sesi. Throw kalau bukan keduanya.
 *
 * Dipakai sebagai gate bersama untuk aksi host-only (tambah order, buat
 * pembayaran/split). Cabang staff sengaja diizinkan — staff urus meja atas nama
 * tamu (mis. sesi walk-in yang tak punya host customer).
 */
export async function assertHostOrActiveStaff(
  sessionId: string,
  profileId: string
): Promise<HostOrStaffResult> {
  // Ambil host_id + bar_id sesi sekaligus (via table → area → bar).
  const [sess] = await db
    .select({
      hostId: sessions.hostId,
      barId: floorAreas.barId,
    })
    .from(sessions)
    .innerJoin(tables, eq(tables.id, sessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(sessions.id, sessionId));
  if (!sess) throw new Error("Session not found");

  const isHost = sess.hostId === profileId;

  // Host langsung lolos.
  if (isHost) {
    return { isHost: true, staffRole: null, barId: sess.barId, hostId: sess.hostId };
  }

  // Bukan host → harus staff aktif di bar sesi.
  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profileId),
        eq(staffRoles.barId, sess.barId),
        eq(staffRoles.isActive, true)
      )
    );
  if (!staff) {
    throw new Error("Only the table host or active staff can do this");
  }

  return {
    isHost: false,
    staffRole: staff.role,
    barId: sess.barId,
    hostId: sess.hostId,
  };
}

/**
 * Wajib STAFF aktif di bar sesi — host TIDAK cukup.
 *
 * Dipakai untuk aksi yang menyentuh milik ANGGOTA (mis. membatalkan order yang
 * dimiliki anggota): host mengelola tagihan meja, tapi tak boleh membatalkan
 * pesanan orang lain — apalagi tanpa sengaja lewat tombol "kembali". Staff tetap
 * boleh karena merekalah yang menangani meja secara fisik.
 */
export async function assertActiveStaffOfSession(
  sessionId: string,
  profileId: string
): Promise<{ staffRole: string; barId: string }> {
  const [sess] = await db
    .select({ barId: floorAreas.barId })
    .from(sessions)
    .innerJoin(tables, eq(tables.id, sessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(sessions.id, sessionId));
  if (!sess) throw new Error("Session not found");

  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profileId),
        eq(staffRoles.barId, sess.barId),
        eq(staffRoles.isActive, true)
      )
    );
  if (!staff) {
    throw new Error("Only the person who placed this order can cancel it");
  }
  return { staffRole: staff.role, barId: sess.barId };
}
