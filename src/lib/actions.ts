"use server";

/**
 * Server Actions — semua mutations untuk session/order/rating/profile.
 *
 * Migrated dari Supabase client ke Drizzle ORM (Phase 4).
 *
 * Authentication: pakai `requireProfile` dari `@/lib/auth-v2/current`
 * (Auth.js v5 + Drizzle profile lookup).
 *
 * Auth actions (signIn/signUp/signOut/magicLink) HILANG dari file ini —
 * sudah pindah ke `@/lib/auth-v2/actions.ts`. UI components yang import
 * dari sini harus diupdate ke auth-v2 path. Reset password & update
 * password DI-DROP sementara (Phase 5 putuskan apakah perlu di-port).
 *
 * Anonymous sign-in DI-DROP (Phase 2 decision).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
  sessionInvites,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { menuItems } from "@/lib/db/schema/menu";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { memberRatings, staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { requireProfile } from "@/lib/auth-v2/current";
import { generateInviteCode } from "@/lib/utils";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import { createNotification, markInviteResponded } from "@/lib/notifications";
import { sendEmail } from "@/lib/auth-v2/email-service";
import { tableInviteEmail } from "@/lib/auth-v2/email-template";
import { getPaymentGateway } from "@/lib/payments/gateway";
import type { PaymentStatus } from "@/types/db";
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_RESERVATION_CONFIG,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";
import {
  calculateDP,
  validateReservationRange,
  type BookedRange,
} from "@/lib/reservation-helpers";

// ============================================================
// SCHEMAS
// ============================================================

const openTableSchema = z.object({
  tableId: z.string().uuid(),
  title: z.string().min(1).max(80).optional(),
  visibility: z.enum(["public", "friends", "invite_only"]),
  vibeTags: z.array(z.string()).max(5).optional(),
  maxGuests: z.number().int().positive().optional(),
  /**
   * Waktu reservasi (ISO string). Optional:
   * - Omit / null = walk-in immediate (status='open')
   * - Set + waktu < 1 menit dari sekarang = walk-in (status='open')
   * - Set + waktu di masa depan = reservation (status='reserved')
   */
  reservationAt: z.string().datetime().nullable().optional(),
  /**
   * Waktu selesai reservasi (ISO string). Wajib kalau reservationAt di masa
   * depan (booking range). Null/omit untuk walk-in.
   */
  reservationEndAt: z.string().datetime().nullable().optional(),
  /**
   * Order initial. Wajib kalau ada min_spend di meja atau reservation_at di
   * masa depan + minDownPaymentPercent > 0. Minimal 1 item.
   */
  initialOrder: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().positive().max(20),
        notes: z.string().max(200).optional(),
      })
    )
    .max(50)
    .optional(),
  /**
   * Payment method untuk DP. Wajib kalau perlu DP. "mock" untuk dev.
   */
  dpMethod: z
    .enum(["qris", "cash", "card", "gopay", "ovo", "mock"])
    .optional(),
  /**
   * User yg diajak/diundang (profile id). Untuk visibility:
   * - "friends": langsung di-join (status joined)
   * - "invite_only": diundang (status pending + invited_by = host)
   * Diabaikan kalau visibility "public".
   */
  invitedUserIds: z.array(z.string().uuid()).max(20).optional(),
});

const addOrderItemSchema = z.object({
  sessionId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  quantity: z.number().int().positive().max(20),
  notes: z.string().max(200).optional(),
  /**
   * Optional: untuk staff input order atas nama member meja.
   * Kalau set, staff harus punya permission assist_order DAN tidak boleh
   * jadi member meja sendiri. Order item akan attributed ke member ini,
   * dengan input_by_staff_id = staff yang call.
   */
  onBehalfOfMemberId: z.string().uuid().optional(),
});

const joinSchema = z.object({
  sessionId: z.string().uuid(),
});

const joinByCodeSchema = z.object({
  code: z.string().min(4).max(12),
});

// ============================================================
// REALTIME NOTIFY HELPER
// ============================================================

/**
 * Notify both session channel + staff bar channel (best-effort, parallel).
 * Dipanggil setelah commit perubahan apapun yang affect session view atau
 * staff dashboard (members, orders, items, payments).
 *
 * Failure di-swallow di notify() — tidak block main flow.
 */
async function notifySessionAndStaff(sessionId: string): Promise<void> {
  // Lookup bar_id (kalau session masih ada — closed sessions tetap valid)
  const [row] = await db
    .select({ bar_id: floorAreas.barId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  await Promise.all([
    notify(channels.session(sessionId)),
    row ? notify(channels.staff(row.bar_id)) : Promise.resolve(),
    // Bar channel juga di-notify supaya floor map (/bar/[slug]) auto-update
    // saat session/member/order/payment berubah.
    row ? notify(channels.bar(row.bar_id)) : Promise.resolve(),
  ]);
}

// ============================================================
// SESSION LIFECYCLE
// ============================================================

/**
 * Open table — single flow untuk walk-in immediate ATAU reservation booking.
 *
 * Logic:
 * - reservationAt NULL atau dalam 1 menit dari sekarang → walk-in (status='open')
 * - reservationAt di masa depan → reservation (status='reserved')
 *
 * Validation kalau reservation:
 * - Bar settings reservation.enabled=true
 * - Slot align dengan interval, min lead time, booking window, operating hours
 *
 * Validation order initial:
 * - Kalau meja punya min_spend > 0 → total order ≥ min_spend
 * - Kalau reservasi + minDownPaymentPercent > 0 → wajib minimal 1 item + DP
 * - Untuk walk-in tanpa min_spend → order initial optional
 *
 * DP:
 * - Hitung: total_order × minDownPaymentPercent / 100, round up to 100
 * - Insert payment row dengan status='pending', call gateway, update
 *   status & dp_paid_at di session row
 */
export async function openTable(input: z.infer<typeof openTableSchema>) {
  const profile = await requireProfile();
  const data = openTableSchema.parse(input);

  // 1. Verify table + ambil min_spend + bar settings
  const [tableRow] = await db
    .select({
      id: tables.id,
      label: tables.label,
      capacity: tables.capacity,
      is_active: tables.isActive,
      min_spend: tables.minSpend,
      bar_id: floorAreas.barId,
      bar_name: bars.name,
      opening_hours: bars.openingHours,
      reservation_config: bars.reservationConfig,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tables.id, data.tableId));
  if (!tableRow) throw new Error("Meja tidak ditemukan");
  if (!tableRow.is_active) throw new Error("Meja sedang tidak aktif");

  const minSpend = tableRow.min_spend ?? 0;

  // 2. Resolve reservation timestamp + mode (walk-in vs reservation)
  const now = new Date();
  const reservationAt =
    data.reservationAt ? new Date(data.reservationAt) : null;
  const reservationEndAt =
    data.reservationEndAt ? new Date(data.reservationEndAt) : null;
  // Walk-in HANYA kalau tidak ada reservationAt sama sekali. Kalau ada
  // reservationAt (dari form reservasi), SELALU reservasi — termasuk slot
  // yang sedang berjalan (mis. pilih 15:00 saat jam 15:42). Tidak ada lagi
  // threshold yang diam-diam mengubah reservasi jadi walk-in.
  const isWalkIn = !reservationAt;

  // 3. Validate reservation range (mulai + selesai) + cek bentrok
  if (!isWalkIn && reservationAt) {
    // Merge dengan defaults dulu (handle existing bar yang belum set field)
    const opHours = {
      ...DEFAULT_OPERATING_HOURS,
      ...((tableRow.opening_hours as OperatingHours) ?? {}),
    };
    const resConfig = {
      ...DEFAULT_RESERVATION_CONFIG,
      ...((tableRow.reservation_config as Partial<ReservationConfig>) ?? {}),
    };

    if (!resConfig.enabled) {
      throw new Error("Reservasi tidak aktif untuk bar ini");
    }
    if (!reservationEndAt) {
      throw new Error("Waktu selesai reservasi wajib dipilih");
    }

    // Ambil reservasi 'reserved' existing di meja ini untuk cek overlap.
    // Hanya yang belum lewat (end > now) yang relevan.
    // Cek overlap dgn session yg punya rentang waktu: reserved ATAU open/locked
    // hasil promote reservasi (yg masih punya reservation range).
    const existingRows = await db
      .select({
        startAt: tableSessions.reservationAt,
        endAt: tableSessions.reservationEndAt,
      })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tableId, data.tableId),
          inArray(tableSessions.status, ["reserved", "open", "locked"])
        )
      );
    const existing: BookedRange[] = existingRows
      .filter((r) => r.startAt && r.endAt && r.endAt.getTime() > now.getTime())
      .map((r) => ({
        startMs: r.startAt!.getTime(),
        endMs: r.endAt!.getTime(),
      }));

    const validation = validateReservationRange(
      reservationAt,
      reservationEndAt,
      now,
      resConfig,
      opHours,
      existing
    );
    if (!validation.ok) {
      throw new Error(validation.reason ?? "Waktu reservasi tidak valid");
    }
  }

  // 4. Fetch resConfig sekali lagi untuk DP calculation
  const resConfig = {
    ...DEFAULT_RESERVATION_CONFIG,
    ...((tableRow.reservation_config as Partial<ReservationConfig>) ?? {}),
  };

  // 5. Validate initial order items + hitung total
  const initialOrder = data.initialOrder ?? [];
  let totalOrder = 0;
  type ResolvedItem = {
    menuItemId: string;
    quantity: number;
    unitPrice: number;
    notes: string | null;
  };
  const resolvedItems: ResolvedItem[] = [];

  if (initialOrder.length > 0) {
    const menuItemIds = initialOrder.map((i) => i.menuItemId);
    const menuRows = await db
      .select({
        id: menuItems.id,
        price: menuItems.price,
        is_available: menuItems.isAvailable,
        name: menuItems.name,
      })
      .from(menuItems)
      .where(inArray(menuItems.id, menuItemIds));
    const menuMap = new Map(menuRows.map((m) => [m.id, m]));

    for (const item of initialOrder) {
      const menu = menuMap.get(item.menuItemId);
      if (!menu) {
        throw new Error("Menu item tidak ditemukan");
      }
      if (!menu.is_available) {
        throw new Error(`Menu "${menu.name}" sedang tidak tersedia`);
      }
      const subtotal = menu.price * item.quantity;
      totalOrder += subtotal;
      resolvedItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: menu.price,
        notes: item.notes ?? null,
      });
    }
  }

  // 6. Min spend check
  if (minSpend > 0 && totalOrder < minSpend) {
    throw new Error(
      `Meja ini ada minimum spend Rp ${minSpend.toLocaleString("id-ID")}. Order kamu baru Rp ${totalOrder.toLocaleString("id-ID")}.`
    );
  }

  // 7. DP requirement: reservation + minDownPaymentPercent > 0
  const dpRequired =
    !isWalkIn && resConfig.minDownPaymentPercent > 0 && totalOrder > 0;
  const dpAmount = dpRequired
    ? calculateDP(totalOrder, resConfig.minDownPaymentPercent)
    : 0;

  if (dpRequired) {
    if (resolvedItems.length === 0) {
      throw new Error("Reservasi wajib dengan minimal 1 item order");
    }
    if (!data.dpMethod) {
      throw new Error("Metode pembayaran DP wajib dipilih");
    }
  }

  // 7b. Resolusi user yg diajak/diundang (cuma untuk friends/invite_only).
  // Validasi: bukan host, non-staff, non-guest, dedup. Cek kapasitas.
  type Invitee = { id: string; name: string; email: string };
  let invitees: Invitee[] = [];
  const inviteMode: "joined" | "invited" | null =
    data.visibility === "friends"
      ? "joined"
      : data.visibility === "invite_only"
        ? "invited"
        : null;
  if (inviteMode && data.invitedUserIds && data.invitedUserIds.length > 0) {
    const uniqueIds = Array.from(new Set(data.invitedUserIds)).filter(
      (id) => id !== profile.id
    );
    if (uniqueIds.length > 0) {
      const staffIds = db.select({ id: staffRoles.profileId }).from(staffRoles);
      const rows = await db
        .select({
          id: profiles.id,
          name: profiles.displayName,
          email: users.email,
        })
        .from(profiles)
        .innerJoin(users, eq(users.id, profiles.id))
        .where(
          and(
            inArray(profiles.id, uniqueIds),
            eq(profiles.isGuest, false),
            sql`${profiles.id} NOT IN (${staffIds})`
          )
        );
      invitees = rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
      // friends auto-join makan slot → cek kapasitas (host + invitees).
      if (inviteMode === "joined") {
        const cap = data.maxGuests ?? tableRow.capacity;
        if (1 + invitees.length > cap) {
          throw new Error(
            `Melebihi kapasitas meja (${cap}). Kurangi teman yang diajak.`
          );
        }
      }
    }
  }

  // 8. Transaction: create session + members + order + items + invite + DP
  let sessionId: string;
  let dpPaymentId: string | null = null;
  let dpStatus: "paid" | "pending" = "pending";
  try {
    const result = await db.transaction(async (tx) => {
      const [newSession] = await tx
        .insert(tableSessions)
        .values({
          tableId: data.tableId,
          hostId: profile.id,
          status: isWalkIn ? "open" : "reserved",
          visibility: data.visibility,
          title: data.title ?? null,
          vibeTags: data.vibeTags ?? [],
          maxGuests: data.maxGuests ?? tableRow.capacity,
          reservationAt: isWalkIn ? null : reservationAt,
          reservationEndAt: isWalkIn ? null : reservationEndAt,
        })
        .returning({ id: tableSessions.id });

      await tx.insert(sessionMembers).values({
        sessionId: newSession.id,
        profileId: profile.id,
        role: "host",
        status: "joined",
      });

      const [newOrder] = await tx
        .insert(orders)
        .values({
          sessionId: newSession.id,
          status: "open",
        })
        .returning({ id: orders.id });

      // Find host member id untuk attribute order items
      const [hostMember] = await tx
        .select({ id: sessionMembers.id })
        .from(sessionMembers)
        .where(
          and(
            eq(sessionMembers.sessionId, newSession.id),
            eq(sessionMembers.profileId, profile.id)
          )
        );

      if (resolvedItems.length > 0 && hostMember) {
        await tx.insert(orderItems).values(
          resolvedItems.map((it) => ({
            orderId: newOrder.id,
            menuItemId: it.menuItemId,
            addedByMemberId: hostMember.id,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            notes: it.notes,
            status: "sent" as const,
          }))
        );
      }

      await tx.insert(sessionInvites).values({
        sessionId: newSession.id,
        code: generateInviteCode(),
        createdBy: profile.id,
      });

      // Ajak/undang user: friends → joined, invite_only → pending+invited_by.
      if (inviteMode && invitees.length > 0) {
        await tx.insert(sessionMembers).values(
          invitees.map((u) => ({
            sessionId: newSession.id,
            profileId: u.id,
            role: "member" as const,
            status: inviteMode === "joined" ? ("joined" as const) : ("pending" as const),
            invitedBy: inviteMode === "invited" ? profile.id : null,
          }))
        );
      }

      // DP payment (kalau perlu) — insert pending dulu, gateway call di luar tx
      if (dpRequired && hostMember) {
        const [newPayment] = await tx
          .insert(payments)
          .values({
            orderId: newOrder.id,
            paidByMemberId: hostMember.id,
            amount: dpAmount,
            method: data.dpMethod!,
            status: "pending",
            splitMode: "custom",
            splitMeta: { isDownPayment: true },
            paidAt: null,
          })
          .returning({ id: payments.id });
        return { sessionId: newSession.id, dpPaymentId: newPayment.id };
      }

      return { sessionId: newSession.id, dpPaymentId: null };
    });
    sessionId = result.sessionId;
    dpPaymentId = result.dpPaymentId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("uq_active_session_per_table")) {
      throw new Error("Meja ini sudah ada session/reservasi aktif");
    }
    throw new Error(message || "Gagal membuka meja");
  }

  // 9. Call gateway untuk DP (kalau ada). Best-effort: kalau gagal, session
  // tetap created tapi DP pending — staff bisa konfirmasi manual nanti.
  if (dpPaymentId && dpAmount > 0) {
    try {
      const gateway = getPaymentGateway();
      const chargeResult = await gateway.createCharge({
        paymentId: dpPaymentId,
        amount: dpAmount,
        method: data.dpMethod!,
        payerName: profile.displayName,
        description: `DP reservasi meja ${tableRow.id.slice(0, 8)}`,
      });
      await db
        .update(payments)
        .set({
          externalRef: chargeResult.externalRef,
          status: chargeResult.status,
          paidAt: chargeResult.status === "paid" ? new Date() : null,
        })
        .where(eq(payments.id, dpPaymentId));
      dpStatus = chargeResult.status === "paid" ? "paid" : "pending";

      // Kalau DP paid, set dp_paid_at di session
      if (chargeResult.status === "paid") {
        await db
          .update(tableSessions)
          .set({ dpPaidAt: new Date() })
          .where(eq(tableSessions.id, sessionId));
      }
    } catch (err) {
      console.error("[openTable] DP gateway charge failed:", err);
      // Don't throw — session tetap exist, staff bisa handle manual
    }
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath("/bar/[slug]", "page");

  // 10. Notif in-app + email ke user yg diajak/diundang (best-effort).
  if (inviteMode && invitees.length > 0) {
    const link = `/session/${sessionId}`;
    const tableLabel = tableRow.label ?? "meja";
    await Promise.allSettled(
      invitees.map(async (u) => {
        await createNotification({
          profileId: u.id,
          type: inviteMode === "joined" ? "table_joined" : "table_invite",
          title:
            inviteMode === "joined"
              ? `${profile.displayName} mengajak kamu gabung`
              : `${profile.displayName} mengundang kamu ke meja ${tableLabel}`,
          body:
            inviteMode === "joined"
              ? `Kamu sudah otomatis bergabung ke meja ${tableLabel}.`
              : `Buka untuk terima undangan ke meja ${tableLabel}.`,
          link,
        });
        const tpl = tableInviteEmail({
          email: u.email,
          inviterName: profile.displayName,
          tableLabel,
          barName: tableRow.bar_name ?? "SOHO",
          link,
          mode: inviteMode,
        });
        await sendEmail({
          to: u.email,
          subject:
            inviteMode === "joined"
              ? `Kamu diajak gabung meja ${tableLabel}`
              : `Undangan ke meja ${tableLabel}`,
          html: tpl.html,
          text: tpl.text,
        });
      })
    );
  }

  // Walk-in → langsung session view (mulai pesan). Reservation → session
  // view juga (lihat status pending DP). Kalau DP pending (mis. QRIS), client
  // bisa show QR. Untuk MVP, redirect ke session page.
  void dpStatus; // unused warning suppress
  redirect(`/session/${sessionId}`);
}

export async function joinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // 1. Session + table capacity (single join)
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      capacity: tables.capacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session not found");
  if (row.status !== "open") throw new Error("Session sudah tidak terbuka");

  // 2. Capacity check
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (Number(count) >= row.capacity) {
    throw new Error("Meja sudah penuh");
  }

  // 3. Upsert member (idempotent via unique constraint session_id+profile_id)
  await db
    .insert(sessionMembers)
    .values({
      sessionId,
      profileId: profile.id,
      role: "member",
      status: "joined",
    })
    .onConflictDoUpdate({
      target: [sessionMembers.sessionId, sessionMembers.profileId],
      set: { status: "joined", leftAt: null },
    });

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  return { ok: true, sessionId };
}

/**
 * Request join: insert member dengan status='pending'. Host harus approve dulu.
 * Berbeda dari joinSession (langsung joined) — request join dipakai dari halaman
 * preview tanpa invite code.
 */
export async function requestJoinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // 1. Session check
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      host_id: tableSessions.hostId,
      capacity: tables.capacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session tidak ditemukan");
  if (row.status !== "open") throw new Error("Session sudah tidak terbuka");
  if (row.host_id === profile.id) {
    throw new Error("Kamu adalah host, tidak perlu request");
  }

  // 2. Capacity check (joined only)
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (Number(count) >= row.capacity) {
    throw new Error("Meja sudah penuh");
  }

  // 3. Existing membership?
  const [existing] = await db
    .select({ id: sessionMembers.id, status: sessionMembers.status })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  if (existing) {
    if (existing.status === "joined") return { status: "joined" as const };
    if (existing.status === "pending") return { status: "pending" as const };
    if (existing.status === "kicked") {
      throw new Error("Kamu pernah dikeluarkan dari meja ini oleh host");
    }
    // 'left' → revert ke pending
    await db
      .update(sessionMembers)
      .set({ status: "pending", leftAt: null })
      .where(eq(sessionMembers.id, existing.id));
  } else {
    await db.insert(sessionMembers).values({
      sessionId,
      profileId: profile.id,
      role: "member",
      status: "pending",
    });
  }

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath(`/session/${sessionId}/preview`);
  return { status: "pending" as const };
}

export async function approveJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  // Host check + capacity check (single join)
  const [row] = await db
    .select({
      host_id: tableSessions.hostId,
      capacity: tables.capacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session tidak ditemukan");
  if (row.host_id !== profile.id) {
    throw new Error("Hanya host yang bisa approve");
  }

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (Number(count) >= row.capacity) {
    throw new Error("Meja sudah penuh, request tidak bisa di-approve");
  }

  // Set pending → joined
  await db
    .update(sessionMembers)
    .set({ status: "joined", joinedAt: new Date() })
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

export async function rejectJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();

  const [session] = await db
    .select({ host_id: tableSessions.hostId })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!session) throw new Error("Session tidak ditemukan");
  if (session.host_id !== profile.id) {
    throw new Error("Hanya host yang bisa reject");
  }

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.id, memberId),
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "pending")
      )
    );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Terima undangan (invite_only): user yg DIUNDANG (member pending dgn
 * invited_by terisi) → jadi joined. Cek kapasitas. Beda dgn approveJoinRequest
 * (itu host yg approve request-join). Di sini USER sendiri yg terima.
 */
export async function acceptInvite(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // Pastikan caller adalah member pending yg DIUNDANG (invited_by not null).
  const [member] = await db
    .select({ id: sessionMembers.id, invitedBy: sessionMembers.invitedBy })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );
  if (!member || member.invitedBy == null) {
    throw new Error("Undangan tidak ditemukan atau sudah tidak berlaku");
  }

  // Kapasitas
  const [row] = await db
    .select({ capacity: tables.capacity, host_id: tableSessions.hostId })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, sessionId));
  if (!row) throw new Error("Session tidak ditemukan");
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined"))
    );
  if (Number(count) >= row.capacity) {
    throw new Error("Meja sudah penuh");
  }

  await db
    .update(sessionMembers)
    .set({ status: "joined", joinedAt: new Date() })
    .where(eq(sessionMembers.id, member.id));

  // Notif ke pengundang bahwa undangan diterima. Pengundang = invited_by
  // (fallback host kalau null, mestinya selalu terisi untuk invite).
  await createNotification({
    profileId: member.invitedBy ?? row.host_id,
    type: "invite_accepted",
    title: `${profile.displayName} menerima undanganmu`,
    body: `${profile.displayName} bergabung ke meja.`,
    link: `/session/${sessionId}`,
  });

  // Tandai notif undangan milik penerima sudah direspon → tombol Terima/Tolak
  // di bell hilang, diganti label "Kamu menerima undangan ini".
  await markInviteResponded(`/session/${sessionId}`, "accepted");

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/** Tolak undangan: hapus member pending yg diundang + beri tahu pengundang. */
export async function declineInvite(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);

  // Baca pengundang + label meja SEBELUM delete (row member hilang setelahnya).
  const [info] = await db
    .select({
      invitedBy: sessionMembers.invitedBy,
      hostId: tableSessions.hostId,
      tableLabel: tables.label,
    })
    .from(sessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, sessionMembers.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );

  await db
    .delete(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "pending")
      )
    );

  // Notif ke pengundang bahwa undangan ditolak (counterpart invite_accepted).
  if (info) {
    await createNotification({
      profileId: info.invitedBy ?? info.hostId,
      type: "invite_rejected",
      title: `${profile.displayName} menolak undanganmu`,
      body: `${profile.displayName} tidak bergabung ke meja ${info.tableLabel}.`,
      link: `/session/${sessionId}`,
    });
  }

  // Tandai notif undangan milik penolak sudah direspon → tombol aksi hilang,
  // diganti label "Kamu menolak undangan ini".
  await markInviteResponded(`/session/${sessionId}`, "rejected");

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

export async function joinByCode(input: z.infer<typeof joinByCodeSchema>) {
  await requireProfile();
  const { code } = joinByCodeSchema.parse(input);

  const [invite] = await db
    .select({
      session_id: sessionInvites.sessionId,
      expires_at: sessionInvites.expiresAt,
      max_uses: sessionInvites.maxUses,
      use_count: sessionInvites.useCount,
    })
    .from(sessionInvites)
    .where(eq(sessionInvites.code, code));
  if (!invite) throw new Error("Kode undangan tidak valid");
  if (invite.expires_at < new Date()) {
    throw new Error("Kode undangan sudah kedaluwarsa");
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    throw new Error("Kode undangan sudah mencapai batas penggunaan");
  }

  await joinSession({ sessionId: invite.session_id });

  // Increment use count (best-effort)
  await db
    .update(sessionInvites)
    .set({ useCount: invite.use_count + 1 })
    .where(eq(sessionInvites.code, code));

  redirect(`/session/${invite.session_id}`);
}

export async function leaveSession(sessionId: string) {
  const profile = await requireProfile();

  await db
    .update(sessionMembers)
    .set({ status: "left", leftAt: new Date() })
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Tutup meja. Boleh dipanggil oleh:
 * - Host meja (customer yang buka meja sendiri)
 * - Staff dengan permission `close_session` (waiter/cashier/manager/admin)
 *
 * Guardrail untuk WAITER: harus lunas. Tujuan: cegah waiter close meja yang
 * belum bayar (resiko kerugian). Cashier/manager/admin tetap bisa close kapan
 * saja (untuk edge case refund / void). Customer host tetap bisa close kapan
 * saja (mereka punya bill sendiri).
 */
export async function closeSession(sessionId: string) {
  const profile = await requireProfile();

  const [session] = await db
    .select({ host_id: tableSessions.hostId })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!session) throw new Error("Session not found");

  const isHost = session.host_id === profile.id;

  // Kalau bukan host, cek apakah dia staff dengan permission close_session
  let staffRoleName: string | null = null;
  if (!isHost) {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
      );
    if (!staff) {
      throw new Error("Hanya host atau staff yang bisa menutup meja");
    }
    staffRoleName = staff.role;
  }

  // Guardrail waiter: hanya boleh close kalau meja lunas
  if (staffRoleName === "waiter") {
    const [billRow] = await db
      .select({
        subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
      })
      .from(orders)
      .leftJoin(
        orderItems,
        and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
      )
      .where(eq(orders.sessionId, sessionId));

    const [paidRow] = await db
      .select({
        paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        and(eq(orders.sessionId, sessionId), eq(payments.status, "paid"))
      );

    const subtotal = Number(billRow?.subtotal ?? 0);
    const paid = Number(paidRow?.paid ?? 0);
    const outstanding = Math.max(0, subtotal - paid);

    if (outstanding > 0) {
      throw new Error(
        `Belum lunas — sisa Rp ${outstanding.toLocaleString("id-ID")}. Arahkan tamu ke kasir.`
      );
    }
  }

  // Close session + orders (parallel)
  const now = new Date();
  await Promise.all([
    db
      .update(tableSessions)
      .set({ status: "closed", closedAt: now })
      .where(eq(tableSessions.id, sessionId)),
    db
      .update(orders)
      .set({ status: "closed", closedAt: now })
      .where(eq(orders.sessionId, sessionId)),
  ]);

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");

  // Customer host → redirect ke rate page. Staff → redirect ke dashboard
  // role-nya supaya bisa lanjut handle meja lain.
  if (isHost) {
    redirect(`/session/${sessionId}/rate`);
  }
  if (staffRoleName === "waiter") redirect("/staff/waiter?tab=sessions");
  if (staffRoleName === "cashier") redirect("/staff/cashier");
  redirect("/admin");
}

export async function leaveSessionAndRate(sessionId: string) {
  await leaveSession(sessionId);
  redirect("/");
}

// ============================================================
// ORDER ITEMS
// ============================================================

export async function addOrderItem(input: z.infer<typeof addOrderItemSchema>) {
  const profile = await requireProfile();
  const data = addOrderItemSchema.parse(input);

  // Tentukan member yang nge-attribute order:
  // - Default: current user = member meja (customer flow)
  // - Kalau onBehalfOfMemberId di-set: staff input atas nama member tsb
  let memberId: string;
  let inputByStaffId: string | null = null;

  if (data.onBehalfOfMemberId) {
    // Staff flow: butuh permission assist_order
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
      );
    if (!staff) {
      throw new Error("Hanya staff yang bisa input atas nama tamu");
    }

    // Verify target member ada di session ini
    const [targetMember] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.id, data.onBehalfOfMemberId),
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!targetMember) {
      throw new Error("Member tujuan tidak ditemukan di meja ini");
    }

    memberId = targetMember.id;
    inputByStaffId = profile.id;
  } else {
    // Customer flow: current user harus member meja
    const [member] = await db
      .select({ id: sessionMembers.id })
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, data.sessionId),
          eq(sessionMembers.profileId, profile.id),
          eq(sessionMembers.status, "joined")
        )
      );
    if (!member) throw new Error("Kamu bukan anggota meja ini");
    memberId = member.id;
  }

  // 2. Find open order
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, data.sessionId), ne(orders.status, "closed")));
  if (!order) throw new Error("Order belum dibuka untuk session ini");

  // 3. Menu item snapshot
  const [item] = await db
    .select({ price: menuItems.price, is_available: menuItems.isAvailable })
    .from(menuItems)
    .where(eq(menuItems.id, data.menuItemId));
  if (!item) throw new Error("Menu item tidak ditemukan");
  if (!item.is_available) throw new Error("Menu item sedang tidak tersedia");

  // 4. Insert
  await db.insert(orderItems).values({
    orderId: order.id,
    menuItemId: data.menuItemId,
    addedByMemberId: memberId,
    inputByStaffId: inputByStaffId,
    quantity: data.quantity,
    unitPrice: item.price,
    notes: data.notes ?? null,
    status: "sent",
  });

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
}

export async function removeOrderItem(itemId: string, sessionId: string) {
  const profile = await requireProfile();

  // Ownership: who added it (via member.profile_id)?
  const [item] = await db
    .select({
      id: orderItems.id,
      added_by_profile_id: sessionMembers.profileId,
    })
    .from(orderItems)
    .innerJoin(
      sessionMembers,
      eq(sessionMembers.id, orderItems.addedByMemberId)
    )
    .where(eq(orderItems.id, itemId));
  if (!item) throw new Error("Item tidak ditemukan");

  const [session] = await db
    .select({ host_id: tableSessions.hostId })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));

  if (
    item.added_by_profile_id !== profile.id &&
    session?.host_id !== profile.id
  ) {
    throw new Error("Hanya yang pesan atau host yang bisa hapus item");
  }

  await db
    .update(orderItems)
    .set({ status: "void" })
    .where(eq(orderItems.id, itemId));

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

// ============================================================
// INVITES
// ============================================================

export async function createInvite(sessionId: string) {
  const profile = await requireProfile();

  const code = generateInviteCode();
  const [newInvite] = await db
    .insert(sessionInvites)
    .values({
      sessionId,
      code,
      createdBy: profile.id,
    })
    .returning();

  revalidatePath(`/session/${sessionId}`);
  return newInvite;
}

// ============================================================
// PAYMENTS (mock for demo)
// ============================================================

const paySchema = z.object({
  sessionId: z.string().uuid(),
  amount: z.number().int().positive(),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
  splitMode: z.enum(["equal", "itemized", "custom"]),
  splitMeta: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Customer self-pay flow (customer bayar sendiri dari HP setelah pesan).
 *
 * Flow:
 * 1. Verify member ada di session
 * 2. Insert payment dengan status='pending'
 * 3. Call gateway abstraction (getPaymentGateway().createCharge)
 * 4. Update payment dengan external_ref + status dari gateway
 * 5. Return result termasuk qrString (untuk QRIS) atau redirectUrl
 *
 * Sekarang implementasi gateway masih mock (auto-paid). Saat production swap
 * ke Xendit/Midtrans, tidak perlu sentuh function ini — cuma implement adapter
 * baru di lib/payments/gateway.ts.
 */
export async function payShare(input: z.infer<typeof paySchema>): Promise<{
  paymentId: string;
  status: PaymentStatus;
  externalRef: string;
  qrString: string | null;
  redirectUrl: string | null;
}> {
  const profile = await requireProfile();
  const data = paySchema.parse(input);

  // 1. Member + profile lookup (butuh display_name untuk receipt gateway)
  const [member] = await db
    .select({ id: sessionMembers.id, displayName: profiles.displayName })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(sessionMembers.sessionId, data.sessionId),
        eq(sessionMembers.profileId, profile.id)
      )
    );
  if (!member) throw new Error("Bukan member meja ini");

  // 2. Open order
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, data.sessionId), ne(orders.status, "closed")));
  if (!order) throw new Error("Order tidak terbuka");

  // 3. Insert payment dengan status='pending'
  const [newPayment] = await db
    .insert(payments)
    .values({
      orderId: order.id,
      paidByMemberId: member.id,
      amount: data.amount,
      method: data.method,
      status: "pending",
      splitMode: data.splitMode,
      splitMeta: data.splitMeta ?? {},
      paidAt: null,
    })
    .returning({ id: payments.id });

  // 4. Call gateway abstraction. Mock → auto-paid. Real gateway → pending + qrString.
  const gateway = getPaymentGateway();
  const chargeResult = await gateway.createCharge({
    paymentId: newPayment.id,
    amount: data.amount,
    method: data.method,
    payerName: member.displayName,
    description: `Self-pay meja - ${data.sessionId.slice(0, 8)}`,
  });

  // 5. Update payment dengan hasil gateway
  await db
    .update(payments)
    .set({
      externalRef: chargeResult.externalRef,
      status: chargeResult.status,
      paidAt: chargeResult.status === "paid" ? new Date() : null,
    })
    .where(eq(payments.id, newPayment.id));

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
  // Invalidate staff dashboards juga supaya cashier list & detail auto-update
  // saat customer self-pay
  revalidatePath("/staff/cashier");
  revalidatePath(`/staff/cashier/${data.sessionId}`);

  return {
    paymentId: newPayment.id,
    status: chargeResult.status,
    externalRef: chargeResult.externalRef,
    qrString: chargeResult.qrString ?? null,
    redirectUrl: chargeResult.redirectUrl ?? null,
  };
}

// ============================================================
// STAFF / WAITER
// ============================================================

/**
 * Guard untuk Server Actions yang butuh staff role.
 * Throw (bukan redirect) supaya error muncul di toast UI, bukan
 * navigate ke halaman lain.
 */
async function requireStaffAction() {
  const profile = await requireProfile();
  const [staff] = await db
    .select({ role: staffRoles.role, bar_id: staffRoles.barId })
    .from(staffRoles)
    .where(
      and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
    );
  if (!staff) {
    throw new Error("Akses staff diperlukan");
  }
  return { profile, staff };
}

export async function markOrderItemStatus(
  itemId: string,
  newStatus: "preparing" | "served"
) {
  await requireStaffAction();

  const patch: { status: "preparing" | "served"; servedAt?: Date } = {
    status: newStatus,
  };
  if (newStatus === "served") {
    patch.servedAt = new Date();
  }

  await db.update(orderItems).set(patch).where(eq(orderItems.id, itemId));

  // Lookup sessionId via order → notify session + staff bar
  const [link] = await db
    .select({ session_id: orders.sessionId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.id, itemId));
  if (link) await notifySessionAndStaff(link.session_id);

  revalidatePath("/staff");
}

// ============================================================
// RATINGS (member-to-member after session closed)
// ============================================================

const submitRatingSchema = z.object({
  sessionId: z.string().uuid(),
  rateeId: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(30)).max(5).optional(),
});

export async function submitRating(input: z.infer<typeof submitRatingSchema>) {
  const profile = await requireProfile();
  const data = submitRatingSchema.parse(input);

  if (data.rateeId === profile.id) {
    throw new Error("Tidak bisa rate diri sendiri");
  }

  await db
    .insert(memberRatings)
    .values({
      sessionId: data.sessionId,
      raterId: profile.id,
      rateeId: data.rateeId,
      stars: data.stars,
      tags: data.tags ?? [],
    })
    .onConflictDoUpdate({
      target: [memberRatings.sessionId, memberRatings.raterId, memberRatings.rateeId],
      set: { stars: data.stars, tags: data.tags ?? [] },
    });

  revalidatePath(`/session/${data.sessionId}/rate`);
}

// ============================================================
// PROFILE
// ============================================================

const updateProfileSchema = z.object({
  displayName: z.string().min(2, "Nama minimal 2 karakter").max(40),
  phone: z
    .string()
    .max(20)
    .regex(/^[\d\s+\-()]*$/, "Format nomor HP tidak valid")
    .optional()
    .or(z.literal("")),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional()
    .or(z.literal("")),
  bio: z.string().max(280, "Bio maksimal 280 karakter").optional().or(z.literal("")),
  hobbies: z.array(z.string().min(1).max(30)).max(15).optional(),
});

export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const profile = await requireProfile();
  const data = updateProfileSchema.parse(input);

  // Clean hobbies: trim + dedup, preserve original-case
  const hobbies = (data.hobbies ?? [])
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .filter((h, i, arr) => arr.indexOf(h) === i);

  await db
    .update(profiles)
    .set({
      displayName: data.displayName,
      phone: data.phone?.trim() || null,
      birthDate: data.birthDate || null,
      bio: data.bio?.trim() || null,
      hobbies,
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
}

// ============================================================
// PASSWORD CHANGE
// ============================================================

const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional(), // optional untuk magic-link users
    newPassword: z.string().min(6, "Password minimal 6 karakter").max(100),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

/**
 * Ubah / set password.
 *
 * - Kalau user sudah punya password (passwordHash != null): WAJIB pass
 *   currentPassword yang harus match.
 * - Kalau user belum punya password (signup via magic link): currentPassword
 *   tidak dipakai, langsung set newPassword.
 *
 * Server-side enforce supaya tidak bisa di-bypass dari client.
 */
export async function changePassword(input: z.infer<typeof changePasswordSchema>) {
  const profile = await requireProfile();
  const data = changePasswordSchema.parse(input);

  const { users } = await import("@/lib/db/schema/auth");
  const { hashPassword, verifyPassword } = await import("@/lib/auth-v2/password");

  // Ambil current hash
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, profile.id));
  if (!user) throw new Error("User tidak ditemukan");

  // Kalau sudah punya password → wajib verify current
  if (user.passwordHash) {
    if (!data.currentPassword) {
      throw new Error("Password sekarang wajib diisi");
    }
    const ok = await verifyPassword(data.currentPassword, user.passwordHash);
    if (!ok) throw new Error("Password sekarang salah");
  }

  // Hash + save
  const newHash = await hashPassword(data.newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, profile.id));

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Cek apakah user sudah punya password (untuk UI decide section "Set password"
 * vs "Ubah password").
 */
export async function userHasPassword(): Promise<boolean> {
  const profile = await requireProfile();
  const { users } = await import("@/lib/db/schema/auth");

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, profile.id));
  return !!user?.passwordHash;
}

// ============================================================
// AVATAR UPLOAD
// ============================================================

const ACCEPTED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // iPhone modern default — convert ke JPEG server-side dulu sebelum sharp
  "image/heic",
  "image/heif",
] as const;
const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10MB pre-process (HEIC bisa besar)

/**
 * Beberapa browser/OS kirim MIME type kosong atau "application/octet-stream"
 * untuk HEIC dari iPhone. Fallback detect via extension nama file.
 */
function isHeicFile(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * Upload avatar foto.
 *
 * Flow:
 * 1. Validate file (type, size)
 * 2. Resize ke 256×256 cover crop + convert ke WebP via sharp
 * 3. Hapus avatar lama (kalau ada) supaya tidak menumpuk
 * 4. Upload ke storage adapter (local disk MVP)
 * 5. Update profiles.avatar_url
 *
 * Pakai FormData supaya bisa terima File langsung dari Client Component.
 */
export async function uploadAvatar(formData: FormData): Promise<{ avatarUrl: string }> {
  const profile = await requireProfile();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("File tidak valid");
  }
  if (file.size === 0) {
    throw new Error("File kosong");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error(
      `File terlalu besar (max ${Math.floor(MAX_AVATAR_BYTES / 1024 / 1024)}MB)`
    );
  }
  const heic = isHeicFile(file);
  const validMime = ACCEPTED_AVATAR_TYPES.includes(
    file.type as (typeof ACCEPTED_AVATAR_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("Format file harus JPG, PNG, WebP, atau HEIC");
  }

  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  // Read file → kalau HEIC, convert ke JPEG dulu (sharp tidak support HEIC
  // dari npm install — perlu libheif system-wide, tidak portable).
  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  // Process: resize 256×256 cover → webp quality 80
  const outputBuffer = await sharp(inputBuffer)
    .rotate() // auto-rotate berdasarkan EXIF (foto dari HP sering miring)
    .resize(256, 256, { fit: "cover", position: "center" })
    .webp({ quality: 80 })
    .toBuffer();

  // Hapus avatar lama kalau ada
  const [oldRow] = await db
    .select({ avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  if (oldRow?.avatarUrl) {
    await storage.delete(oldRow.avatarUrl);
  }

  // Upload baru
  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "avatars",
    key: profile.id,
    contentType: "image/webp",
  });

  // Cache-bust: append timestamp supaya browser refresh image kalau user upload ulang
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;

  await db
    .update(profiles)
    .set({ avatarUrl: versionedUrl })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");

  return { avatarUrl: versionedUrl };
}

/**
 * Hapus avatar (kembali ke initials fallback).
 */
export async function deleteAvatar(): Promise<void> {
  const profile = await requireProfile();
  const { storage } = await import("@/lib/storage");

  const [row] = await db
    .select({ avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));

  if (row?.avatarUrl) {
    await storage.delete(row.avatarUrl);
  }

  await db
    .update(profiles)
    .set({ avatarUrl: null })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
}
