"use server";

/**
 * Server Actions untuk Waiter dashboard.
 *
 * Operations:
 * - getOrderQueueForWaiter: list order item status='sent' dari semua meja aktif
 * - getActiveSessionsForWaiter: list meja aktif dengan info untuk bantu pesan
 * - waiterMarkServed: mark order item sebagai served
 * - waiterJoinSession: insert waiter sebagai session member (untuk bantu pesan)
 *
 * Semua action butuh permission yang sesuai (view_queue / assist_order / update_order_status).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
  sessionInvites,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { menuItems } from "@/lib/db/schema/menu";
import { requirePermission } from "@/lib/auth-v2/permissions";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";
import { generateInviteCode } from "@/lib/utils";
import crypto from "node:crypto";

// ============================================================
// ORDER QUEUE
// ============================================================

export interface WaiterQueueItem {
  id: string;
  quantity: number;
  notes: string | null;
  created_at: string;
  menu_item_name: string;
  added_by_name: string;
  added_by_avatar: string | null;
  table_label: string;
  area_name: string;
  session_id: string;
  session_title: string | null;
}

/**
 * Order item yang baru di-pesan customer (status='sent') dari semua meja
 * aktif di bar. Sorted oldest first (FIFO — antar yang paling lama dulu).
 */
export async function getOrderQueueForWaiter(): Promise<WaiterQueueItem[]> {
  const ctx = await requirePermission("view_queue", "/staff/waiter");

  const rows = await db
    .select({
      id: orderItems.id,
      quantity: orderItems.quantity,
      notes: orderItems.notes,
      created_at: orderItems.createdAt,
      menu_item_name: menuItems.name,
      added_by_name: profiles.displayName,
      added_by_avatar: profiles.avatarUrl,
      table_label: tables.label,
      area_name: floorAreas.name,
      session_id: tableSessions.id,
      session_title: tableSessions.title,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .innerJoin(
      sessionMembers,
      eq(sessionMembers.id, orderItems.addedByMemberId)
    )
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        eq(orderItems.status, "sent"),
        inArray(tableSessions.status, ["open", "locked", "overdue"])
      )
    )
    .orderBy(asc(orderItems.createdAt));

  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    notes: r.notes,
    created_at: r.created_at.toISOString(),
    menu_item_name: r.menu_item_name,
    added_by_name: r.added_by_name,
    added_by_avatar: r.added_by_avatar,
    table_label: r.table_label,
    area_name: r.area_name,
    session_id: r.session_id,
    session_title: r.session_title,
  }));
}

// ============================================================
// ACTIVE SESSIONS (untuk tab "Meja Aktif")
// ============================================================

export interface WaiterSessionItem {
  session_id: string;
  table_label: string;
  area_name: string;
  title: string | null;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  table_capacity: number;
  started_at: string;
  subtotal: number;
  paid_total: number;
  outstanding: number;
  is_paid: boolean;
  item_count: number;
}

export async function getActiveSessionsForWaiter(): Promise<WaiterSessionItem[]> {
  const ctx = await requirePermission("view_queue", "/staff/waiter");

  // Sessions aktif di bar
  const sessionRows = await db
    .select({
      id: tableSessions.id,
      table_label: tables.label,
      area_name: floorAreas.name,
      title: tableSessions.title,
      host_id: tableSessions.hostId,
      host_name: profiles.displayName,
      host_avatar: profiles.avatarUrl,
      started_at: tableSessions.startedAt,
      table_capacity: tables.capacity,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(
      and(
        eq(floorAreas.barId, ctx.barId),
        inArray(tableSessions.status, ["open", "locked", "overdue"])
      )
    )
    .orderBy(asc(tableSessions.startedAt));

  if (sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((s) => s.id);

  // Bill aggregate (subtotal + item count)
  const bills = await db
    .select({
      session_id: orders.sessionId,
      subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
      item_count: sql<number>`COUNT(${orderItems.id})::int`,
    })
    .from(orders)
    .leftJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), ne(orderItems.status, "void"))
    )
    .where(inArray(orders.sessionId, sessionIds))
    .groupBy(orders.sessionId);
  const billMap = new Map(bills.map((b) => [b.session_id, b]));

  // Paid aggregate per session (sum payments yang status=paid)
  const paidRows = await db
    .select({
      session_id: orders.sessionId,
      paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(inArray(orders.sessionId, sessionIds), eq(payments.status, "paid"))
    )
    .groupBy(orders.sessionId);
  const paidMap = new Map(paidRows.map((p) => [p.session_id, Number(p.paid)]));

  // Member count
  const memberCountRows = await db
    .select({
      session_id: sessionMembers.sessionId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(sessionMembers)
    .where(
      and(
        inArray(sessionMembers.sessionId, sessionIds),
        eq(sessionMembers.status, "joined")
      )
    )
    .groupBy(sessionMembers.sessionId);
  const memberMap = new Map(
    memberCountRows.map((m) => [m.session_id, Number(m.count)])
  );

  return sessionRows.map((s) => {
    const subtotal = Number(billMap.get(s.id)?.subtotal ?? 0);
    const paid = paidMap.get(s.id) ?? 0;
    return {
      session_id: s.id,
      table_label: s.table_label,
      area_name: s.area_name,
      title: s.title,
      host_name: s.host_name,
      host_avatar: s.host_avatar,
      member_count: memberMap.get(s.id) ?? 0,
      table_capacity: s.table_capacity,
      started_at: s.started_at.toISOString(),
      subtotal,
      paid_total: paid,
      outstanding: Math.max(0, subtotal - paid),
      is_paid: subtotal > 0 && paid >= subtotal,
      item_count: Number(billMap.get(s.id)?.item_count ?? 0),
    };
  });
}

// ============================================================
// MARK SERVED
// ============================================================

/**
 * Mark order item sebagai served (sudah diantar ke meja).
 * Skip status preparing — langsung sent → served.
 */
export async function waiterMarkServed(itemId: string): Promise<void> {
  const ctx = await requirePermission("update_order_status", "/staff/waiter");

  // Verify item exists & di bar yang sama
  const [item] = await db
    .select({
      id: orderItems.id,
      session_id: tableSessions.id,
      bar_id: floorAreas.barId,
      current_status: orderItems.status,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(orderItems.id, itemId));

  if (!item) throw new Error("Order item tidak ditemukan");
  if (item.bar_id !== ctx.barId) throw new Error("Akses bar tidak valid");
  if (item.current_status === "served") {
    return; // Idempotent — sudah served
  }
  if (item.current_status === "void") {
    throw new Error("Item ini sudah di-batalkan");
  }

  await db
    .update(orderItems)
    .set({ status: "served", servedAt: new Date() })
    .where(eq(orderItems.id, itemId));

  await notify(channels.session(item.session_id), { type: "order.served" });
  await notify(channels.staff(ctx.barId), { type: "order.served" });
  await notify(channels.bar(ctx.barId), { type: "order.served" });

  revalidatePath("/staff/waiter");
}

// ============================================================
// JOIN SESSION (Bantu Pesan)
// ============================================================

/**
 * Waiter join session sebagai member supaya bisa add order item atas nama
 * customer. Idempotent — kalau sudah joined, skip insert.
 *
 * Setelah join, redirect ke /session/[id] (UI customer) supaya waiter
 * bisa pakai cart UI standar untuk bantu pesan.
 */
export async function waiterJoinSession(sessionId: string): Promise<void> {
  const ctx = await requirePermission("assist_order", "/staff/waiter");

  // Validate session ada & status open di bar yang sama
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      bar_id: floorAreas.barId,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  if (!row) throw new Error("Session tidak ditemukan");
  if (row.bar_id !== ctx.barId) throw new Error("Akses bar tidak valid");
  if (row.status !== "open") {
    throw new Error("Session sudah tidak terbuka — tidak bisa bantu pesan");
  }

  // Waiter TIDAK insert sebagai member meja. Konsep: staff = operator, bukan
  // customer. Session view (page customer) akan detect staffRole dari session
  // lookup dan grant interact rights (pesan, view bill) tanpa harus jadi member.
  // Order item yang waiter input akan attributed ke member meja yang dia pilih
  // di picker "Pesan untuk: [member]", dengan input_by_staff_id = waiter
  // sebagai audit trail.
  //
  // Edge case: kalau waiter sebelumnya pernah jadi member (mis. sebelum
  // refactor ini), set status=left supaya gak muncul di member list.
  const [existing] = await db
    .select({ id: sessionMembers.id, status: sessionMembers.status })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, ctx.profileId),
        eq(sessionMembers.status, "joined")
      )
    );
  if (existing) {
    await db
      .update(sessionMembers)
      .set({ status: "left", leftAt: new Date() })
      .where(eq(sessionMembers.id, existing.id));
    await notify(channels.session(sessionId), { type: "member.left" });
    await notify(channels.staff(ctx.barId), { type: "member.left" });
    await notify(channels.bar(ctx.barId), { type: "member.left" });
  }

  revalidatePath("/staff/waiter");
  redirect(`/session/${sessionId}`);
}

// ============================================================
// OPEN TABLE FOR CUSTOMER (Walk-in tanpa HP)
// ============================================================

export interface AvailableTable {
  id: string;
  label: string;
  area_name: string;
  capacity: number;
}

/**
 * List meja yang tersedia (belum ada session aktif) di bar.
 * Dipakai untuk modal "Buka Meja Baru" — waiter pilih meja kosong.
 */
export async function getAvailableTablesForWaiter(): Promise<AvailableTable[]> {
  const ctx = await requirePermission("open_table_for_customer", "/staff/waiter");

  // Sub-query: meja yang sedang ada session aktif (open / locked)
  const occupiedTableIds = await db
    .select({ table_id: tableSessions.tableId })
    .from(tableSessions)
    .where(inArray(tableSessions.status, ["open", "locked", "overdue"]));

  const occupiedSet = new Set(occupiedTableIds.map((r) => r.table_id));

  const rows = await db
    .select({
      id: tables.id,
      label: tables.label,
      area_name: floorAreas.name,
      capacity: tables.capacity,
      area_sort: floorAreas.sortOrder,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(and(eq(floorAreas.barId, ctx.barId), eq(tables.isActive, true)))
    .orderBy(asc(floorAreas.sortOrder), asc(tables.label));

  return rows
    .filter((r) => !occupiedSet.has(r.id))
    .map((r) => ({
      id: r.id,
      label: r.label,
      area_name: r.area_name,
      capacity: r.capacity,
    }));
}

/**
 * Waiter buka meja untuk customer walk-in (yang tidak bawa HP).
 *
 * Konsep: customer adalah "yang punya bill", staff adalah "yang nge-handle".
 * Untuk walk-in tanpa akun, kita bikin GUEST PROFILE (placeholder, is_guest=true)
 * pakai nama tamu utama. Guest jadi host session. Waiter join sebagai member
 * biasa supaya bisa add order item atas nama tamu.
 *
 * Flow:
 * 1. Validate table aktif & belum ada session
 * 2. Create users row dengan fake email (passwordHash NULL = can't login)
 * 3. Create profiles row dengan displayName = nama tamu utama, is_guest=true
 * 4. Insert session dengan host = guest profile, opened_by_staff_id = waiter
 * 5. Insert dua session_members: guest (host) + waiter (member)
 * 6. Insert empty order
 * 7. Insert invite code (by waiter)
 * 8. Redirect ke /session/[id] supaya waiter bisa pakai cart UI standar
 *
 * @param tableId  - UUID meja yang dipilih
 * @param guestNames - List nama tamu. Index 0 = nama utama (jadi guest profile).
 *                     Length max = table.capacity.
 */
export async function staffOpenTableForCustomer(
  tableId: string,
  guestNames: string[]
): Promise<void> {
  const ctx = await requirePermission(
    "open_table_for_customer",
    "/staff/waiter"
  );

  // Clean & filter empty names
  const cleanNames = guestNames
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (cleanNames.length === 0) {
    throw new Error("Minimal 1 nama tamu wajib diisi");
  }
  if (cleanNames.some((n) => n.length > 80)) {
    throw new Error("Setiap nama tamu maksimal 80 karakter");
  }

  // Validate table aktif & ada di bar yang sama
  const [table] = await db
    .select({
      id: tables.id,
      capacity: tables.capacity,
      isActive: tables.isActive,
      barId: floorAreas.barId,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tables.id, tableId));

  if (!table) throw new Error("Meja tidak ditemukan");
  if (!table.isActive) throw new Error("Meja tidak aktif");
  if (table.barId !== ctx.barId) throw new Error("Akses bar tidak valid");
  if (cleanNames.length > table.capacity) {
    throw new Error(
      `Maksimal ${table.capacity} tamu untuk meja ini (kapasitas)`
    );
  }

  const mainGuest = cleanNames[0];

  let sessionId: string;
  try {
    sessionId = await db.transaction(async (tx) => {
      // 1. Create guest user (fake email, no password — can't login)
      const guestToken = crypto.randomBytes(8).toString("hex");
      const guestEmail = `guest-${guestToken}@walkin.soho`;

      const [newUser] = await tx
        .insert(users)
        .values({
          email: guestEmail,
          name: mainGuest,
          passwordHash: null, // No login
        })
        .returning({ id: users.id });

      // 2. Create guest profile (is_guest=true)
      const [newProfile] = await tx
        .insert(profiles)
        .values({
          id: newUser.id, // 1-1 with users
          displayName: mainGuest,
          isGuest: true,
        })
        .returning({ id: profiles.id });

      // 3. Insert session — host = guest profile (bukan waiter!)
      const [newSession] = await tx
        .insert(tableSessions)
        .values({
          tableId,
          hostId: newProfile.id, // Guest = host (yang punya bill)
          status: "open",
          visibility: "invite_only",
          title: mainGuest,
          maxGuests: table.capacity,
          openedByStaffId: ctx.profileId, // Audit: waiter yang buka
          guestNames: cleanNames,
        })
        .returning({ id: tableSessions.id });

      // 4. Insert session member — HANYA guest sebagai host.
      // Waiter TIDAK jadi member meja — dia hanya operator (audit trail di
      // opened_by_staff_id). Saat input order, item akan di-attribute ke
      // member meja (guest), dengan input_by_staff_id = waiter untuk audit.
      await tx.insert(sessionMembers).values({
        sessionId: newSession.id,
        profileId: newProfile.id,
        role: "host",
        status: "joined",
      });

      // Kalau ada tamu tambahan (cleanNames[1..]), bikin guest profile untuk
      // tiap tamu juga supaya semua tamu tampak di member list.
      if (cleanNames.length > 1) {
        for (const extraName of cleanNames.slice(1)) {
          const extraToken = crypto.randomBytes(8).toString("hex");
          const extraEmail = `guest-${extraToken}@walkin.soho`;
          const [extraUser] = await tx
            .insert(users)
            .values({
              email: extraEmail,
              name: extraName,
              passwordHash: null,
            })
            .returning({ id: users.id });
          const [extraProfile] = await tx
            .insert(profiles)
            .values({
              id: extraUser.id,
              displayName: extraName,
              isGuest: true,
            })
            .returning({ id: profiles.id });
          await tx.insert(sessionMembers).values({
            sessionId: newSession.id,
            profileId: extraProfile.id,
            role: "member",
            status: "joined",
          });
        }
      }

      await tx.insert(orders).values({
        sessionId: newSession.id,
        status: "open",
      });

      await tx.insert(sessionInvites).values({
        sessionId: newSession.id,
        code: generateInviteCode(),
        createdBy: ctx.profileId, // Waiter generate invite
      });

      return newSession.id;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("uq_active_session_per_table")) {
      throw new Error("Meja ini sudah ada session aktif");
    }
    throw new Error(message || "Gagal membuka meja");
  }

  await notify(channels.session(sessionId), { type: "session.opened" });
  await notify(channels.staff(ctx.barId), { type: "session.opened" });
  await notify(channels.bar(ctx.barId), { type: "session.opened" });

  revalidatePath("/staff/waiter");
  revalidatePath("/staff/cashier");
  redirect(`/session/${sessionId}`);
}

// ============================================================
// ADD GUEST TO EXISTING TABLE
// ============================================================

/**
 * Staff tambah tamu baru ke meja yang sudah aktif.
 *
 * Validasi: slot belum penuh (current member count < table.capacity), session
 * masih open, session memang dibuka oleh staff (walk-in). Untuk session
 * customer biasa (self-service), tidak boleh — biar customer invite sendiri.
 */
export async function staffAddGuestToTable(
  sessionId: string,
  guestName: string
): Promise<void> {
  const ctx = await requirePermission(
    "open_table_for_customer",
    "/staff/waiter"
  );

  const cleanName = guestName.trim();
  if (!cleanName) throw new Error("Nama tamu wajib diisi");
  if (cleanName.length > 80) throw new Error("Nama tamu maksimal 80 karakter");

  // Get session + capacity
  const [session] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      openedByStaffId: tableSessions.openedByStaffId,
      tableCapacity: tables.capacity,
      barId: floorAreas.barId,
      guestNames: tableSessions.guestNames,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  if (!session) throw new Error("Session tidak ditemukan");
  if (session.barId !== ctx.barId) throw new Error("Akses bar tidak valid");
  if (session.status !== "open") {
    throw new Error("Session sudah tidak open");
  }
  if (!session.openedByStaffId) {
    throw new Error(
      "Session ini dibuka customer sendiri — minta customer untuk invite teman"
    );
  }

  // Count current members
  const [memberCountRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.status, "joined")
      )
    );
  const currentCount = Number(memberCountRow?.count ?? 0);

  if (currentCount >= session.tableCapacity) {
    throw new Error(
      `Meja sudah penuh (${currentCount}/${session.tableCapacity})`
    );
  }

  // Insert guest user + profile + member dalam transaction
  await db.transaction(async (tx) => {
    const token = crypto.randomBytes(8).toString("hex");
    const fakeEmail = `guest-${token}@walkin.soho`;

    const [newUser] = await tx
      .insert(users)
      .values({
        email: fakeEmail,
        name: cleanName,
        passwordHash: null,
      })
      .returning({ id: users.id });

    const [newProfile] = await tx
      .insert(profiles)
      .values({
        id: newUser.id,
        displayName: cleanName,
        isGuest: true,
      })
      .returning({ id: profiles.id });

    await tx.insert(sessionMembers).values({
      sessionId,
      profileId: newProfile.id,
      role: "member",
      status: "joined",
    });

    // Update guest_names di session untuk denormalized cache
    await tx
      .update(tableSessions)
      .set({ guestNames: [...session.guestNames, cleanName] })
      .where(eq(tableSessions.id, sessionId));
  });

  await notify(channels.session(sessionId), { type: "member.joined" });
  await notify(channels.staff(ctx.barId), { type: "member.joined" });
  await notify(channels.bar(ctx.barId), { type: "member.joined" });

  revalidatePath(`/session/${sessionId}`);
  revalidatePath("/staff/waiter");
}

// Suppress unused import warnings
void desc;
void notInArray;
