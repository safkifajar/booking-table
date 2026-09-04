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

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionInvites,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import { createNotification } from "@/lib/notifications";
import { sendEmail } from "@/lib/auth-v2/email-service";
import { tableInviteEmail } from "@/lib/auth-v2/email-template";

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


/**
 * Kirim undangan (notif in-app + email) ke SEMUA member 'pending' berundang
 * (invitedBy not null) di sebuah sesi — self-contained (baca data dari DB via
 * sessionId, tak butuh state in-memory).
 *
 * Dipakai untuk booking yang butuh DP: undangan hanya dikirim SETELAH DP lunas,
 * bukan saat booking dibuat (yang mungkin belum dibayar / batal). Idempotensi
 * dijamin PEMANGGIL — dipanggil hanya pada transisi dp_paid_at null→terisi
 * (sekali seumur booking), jadi tak perlu penanda per-member.
 *
 * Best-effort: kegagalan notif/email tak boleh menggagalkan alur pembayaran.
 */
export async function sendBookingInvites(sessionId: string): Promise<void> {
  // Host (pengundang) + meja + bar untuk isi teks undangan.
  const [meta] = await db
    .select({
      hostId: tableSessions.hostId,
      hostName: profiles.displayName,
      tableLabel: tables.label,
      barName: bars.name,
    })
    .from(tableSessions)
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tableSessions.id, sessionId));
  if (!meta) return;

  // Member yang diundang & masih pending (belum accept/decline) + email +
  // pengundang (untuk arsip).
  const invited = await db
    .select({
      profileId: sessionMembers.profileId,
      email: users.email,
      invitedBy: sessionMembers.invitedBy,
    })
    .from(sessionMembers)
    .innerJoin(users, eq(users.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending"),
        isNotNull(sessionMembers.invitedBy)
      )
    );
  if (invited.length === 0) return;

  // Arsip undangan (record /profile/invites). Upsert: undang-ulang orang yg sama
  // ke sesi ini reset ke pending. invitedAt = sekarang (waktu undangan benar-2
  // dikirim = setelah DP lunas), respondedAt di-null-kan.
  await recordSessionInvites(
    sessionId,
    invited
      .filter((u) => u.invitedBy)
      .map((u) => ({ inviterId: u.invitedBy as string, inviteeId: u.profileId }))
  ).catch((e) => console.error("[invite] archive booking:", e));

  const link = `/session/${sessionId}`;
  const tableLabel = meta.tableLabel ?? "table";
  await Promise.allSettled(
    invited.map(async (u) => {
      await createNotification({
        profileId: u.profileId,
        type: "table_invite",
        title: `${meta.hostName} invited you to table ${tableLabel}`,
        body: `Open to accept the invite to table ${tableLabel}.`,
        link,
        actorId: meta.hostId, // foto pengundang di list notifikasi
      });
      const tpl = tableInviteEmail({
        email: u.email,
        inviterName: meta.hostName,
        tableLabel,
        barName: meta.barName ?? "SOHO",
        link,
        mode: "invited",
      });
      await sendEmail({
        to: u.email,
        subject: `Invite to table ${tableLabel}`,
        kind: "table_invite",
        html: tpl.html,
        text: tpl.text,
      });
    })
  );
}
