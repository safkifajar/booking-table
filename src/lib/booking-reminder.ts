import "server-only";
import { and, eq, gte, isNotNull, isNull, lte, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { createNotification } from "@/lib/notifications";
import { DEFAULT_RESERVATION_CONFIG } from "@/lib/settings-constants";
import type { ReservationConfig } from "@/lib/settings-constants";

/**
 * Pengingat "sebentar lagi jam booking" — dikirim ke tamu menjelang waktu
 * reservasi, seperti notifikasi driver ojol yang sudah dekat.
 *
 * Dipanggil cron berkala (/api/cron/booking-reminder). Prinsip:
 * - SEKALI saja per reservasi: ditandai table_sessions.reminder_sent_at.
 *   Tanpa ini tamu dikirimi pengingat berulang tiap cron menyala.
 * - Per-bar: tiap bar punya reminderMinutesBefore sendiri (0 = mati).
 * - Hanya reservasi yang MASIH berlaku: status 'reserved'. Yang sudah
 *   dibatalkan/terlanjur dibuka tak perlu diingatkan.
 * - Best-effort: satu notifikasi gagal tak menggagalkan sisanya.
 */

/** Ambang toleransi keterlambatan cron (menit). */
const GRACE_MINUTES = 10;

/** "18:30" waktu Jakarta — dipakai di badan notifikasi. */
function formatTimeJakarta(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(d);
}

/** "in 30 minutes" / "in 1 hour" / "in 1 hour 30 minutes". */
function humanizeLead(minutes: number): string {
  if (minutes < 60) return `in ${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hourPart = `${h} hour${h > 1 ? "s" : ""}`;
  if (m === 0) return `in ${hourPart}`;
  return `in ${hourPart} ${m} minutes`;
}

export interface BookingReminderResult {
  /** Reservasi yang diproses (ditandai terkirim). */
  sessions: number;
  /** Notifikasi yang berhasil dibuat (bisa > sessions: satu meja banyak tamu). */
  notified: number;
  durationMs: number;
}

export async function sendBookingReminders(): Promise<BookingReminderResult> {
  const startedAt = Date.now();
  const now = new Date();

  // Bar yang mengaktifkan pengingat. Tiap bar punya lead time sendiri, jadi
  // ambang waktunya dihitung per bar (bukan satu ambang global).
  const barRows = await db
    .select({ id: bars.id, name: bars.name, config: bars.reservationConfig })
    .from(bars);

  let sessions = 0;
  let notified = 0;

  for (const bar of barRows) {
    const cfg: ReservationConfig = {
      ...DEFAULT_RESERVATION_CONFIG,
      ...((bar.config as Partial<ReservationConfig>) ?? {}),
    };
    const lead = cfg.reminderMinutesBefore;
    if (!cfg.enabled || lead <= 0) continue;

    // Jendela kirim: reservasi yang jamnya antara sekarang dan (sekarang +
    // lead). Batas bawah dimundurkan GRACE_MINUTES supaya reservasi tak
    // terlewat kalau cron telat jalan — sekali kirim tetap dijaga oleh
    // reminder_sent_at.
    const windowEnd = new Date(now.getTime() + lead * 60_000);
    const windowStart = new Date(now.getTime() - GRACE_MINUTES * 60_000);

    const due = await db
      .select({
        id: tableSessions.id,
        reservationAt: tableSessions.reservationAt,
        tableLabel: tables.label,
      })
      .from(tableSessions)
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
      .where(
        and(
          eq(floorAreas.barId, bar.id),
          eq(tableSessions.status, "reserved"),
          isNull(tableSessions.reminderSentAt),
          isNotNull(tableSessions.reservationAt),
          gte(tableSessions.reservationAt, windowStart),
          lte(tableSessions.reservationAt, windowEnd)
        )
      );

    if (due.length === 0) continue;

    // Tandai TERKIRIM LEBIH DULU (conditional: hanya yang masih NULL). Kalau
    // ditandai belakangan, cron yang tumpang-tindih bisa mengirim dobel.
    // Konsekuensinya: kalau notifikasi gagal, pengingat itu hilang — dipilih
    // sadar, karena notifikasi dobel lebih mengganggu tamu daripada terlewat.
    const claimed = await db
      .update(tableSessions)
      .set({ reminderSentAt: now })
      .where(
        and(
          inArray(
            tableSessions.id,
            due.map((d) => d.id)
          ),
          isNull(tableSessions.reminderSentAt)
        )
      )
      .returning({ id: tableSessions.id });

    const claimedIds = new Set(claimed.map((c) => c.id));
    const toNotify = due.filter((d) => claimedIds.has(d.id));
    sessions += toNotify.length;

    for (const s of toNotify) {
      // Semua tamu yang masih tergabung — bukan cuma host. Tamu walk-in
      // (is_guest) dilewati: mereka tak punya akun & tak bisa menerima notif.
      const members = await db
        .select({ profileId: sessionMembers.profileId })
        .from(sessionMembers)
        .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
        .where(
          and(
            eq(sessionMembers.sessionId, s.id),
            eq(sessionMembers.status, "joined"),
            eq(profiles.isGuest, false)
          )
        );

      const at = s.reservationAt!;
      const minutesLeft = Math.max(
        1,
        Math.round((at.getTime() - now.getTime()) / 60_000)
      );
      const time = formatTimeJakarta(at);

      for (const m of members) {
        try {
          await createNotification({
            profileId: m.profileId,
            type: "booking_reminder",
            title: `Your table is ready ${humanizeLead(minutesLeft)}`,
            body: `Table ${s.tableLabel} at ${bar.name} is booked for ${time}. Head over now so you don't lose your slot. Already here? Enjoy your night.`,
            link: `/session/${s.id}`,
            refId: s.id,
          });
          notified++;
        } catch (err) {
          // Best-effort: satu tamu gagal tak boleh menghentikan sisanya.
          console.error("[booking-reminder] gagal kirim:", m.profileId, err);
        }
      }
    }
  }

  return { sessions, notified, durationMs: Date.now() - startedAt };
}
