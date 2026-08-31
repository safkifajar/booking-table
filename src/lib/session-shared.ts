import "server-only";

/**
 * Pembantu yang dipakai BERSAMA oleh beberapa bagian actions.ts.
 *
 * Dipisah lebih dulu, sebelum bagian-bagian besar actions.ts dipecah:
 * selama pembantu ini masih tinggal di salah satu bagian, memindahkan
 * bagian lain akan menariknya ikut — atau membuat dua modul saling
 * mengimpor. Percobaan memecah tanpa langkah ini (30 Agustus) buntu karena
 * itu.
 *
 * Isinya sengaja hanya yang benar-benar lintas-bagian. Pembantu yang cuma
 * dipakai satu bagian tetap tinggal di tempatnya, ikut pindah nanti.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions, sessionInvites } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";

/**
 * Beri tahu saluran sesi + saluran staf + saluran bar sekaligus.
 *
 * Dipanggil setelah setiap perubahan yang mempengaruhi tampilan sesi atau
 * dasbor staf (anggota, pesanan, item, pembayaran).
 *
 * Kegagalannya ditelan di dalam notify() — pemberitahuan yang gagal tak
 * boleh menggagalkan perubahan yang sudah tersimpan.
 */
export async function notifySessionAndStaff(sessionId: string): Promise<void> {
  // Cari bar_id — sesi yang sudah ditutup pun tetap sah untuk diberitahukan.
  const [row] = await db
    .select({ bar_id: floorAreas.barId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  await Promise.all([
    notify(channels.session(sessionId)),
    row ? notify(channels.staff(row.bar_id)) : Promise.resolve(),
    // Saluran bar juga diberi tahu supaya denah meja (/bar/[slug]) ikut
    // memperbarui diri saat sesi/anggota/pesanan/pembayaran berubah.
    row ? notify(channels.bar(row.bar_id)) : Promise.resolve(),
  ]);
}

/**
 * Catat/segarkan arsip undangan (session_invites) — catatan untuk
 * /profile/invites.
 *
 * Upsert per (sesi, orang yang diundang): mengundang ulang orang yang sama
 * ke sesi ini akan mengembalikannya ke 'pending' dengan waktu undangan baru
 * (mengikuti pola friend_requests yang dipakai ulang per pasangan).
 *
 * Dipanggil saat undangan BENAR-BENAR dikirim — untuk booking berarti
 * setelah DP lunas, bukan saat bookingnya dibuat.
 */
export async function recordSessionInvites(
  sessionId: string,
  invites: { inviterId: string; inviteeId: string }[]
): Promise<void> {
  if (invites.length === 0) return;
  await db
    .insert(sessionInvites)
    .values(
      invites.map((i) => ({
        sessionId,
        inviterId: i.inviterId,
        inviteeId: i.inviteeId,
        status: "pending" as const,
      }))
    )
    .onConflictDoUpdate({
      target: [sessionInvites.sessionId, sessionInvites.inviteeId],
      set: {
        inviterId: sql`excluded.inviter_id`,
        status: sql`'pending'::invite_status`,
        invitedAt: sql`now()`,
        respondedAt: sql`NULL`,
      },
    });
}

/**
 * Tandai arsip undangan sudah direspon (accepted/declined) atau dibatalkan.
 *
 * Best-effort; hanya menyentuh baris yang masih 'pending' supaya tak
 * menimpa status yang sudah final.
 */
export async function markSessionInviteResponded(
  sessionId: string,
  inviteeId: string,
  status: "accepted" | "declined" | "cancelled"
): Promise<void> {
  await db
    .update(sessionInvites)
    .set({ status, respondedAt: new Date() })
    .where(
      and(
        eq(sessionInvites.sessionId, sessionId),
        eq(sessionInvites.inviteeId, inviteeId),
        eq(sessionInvites.status, "pending")
      )
    );
}
