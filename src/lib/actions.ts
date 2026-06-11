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
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
  sessionInvites,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { menuItems } from "@/lib/db/schema/menu";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { memberRatings, staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { requireProfile } from "@/lib/auth-v2/current";
import { generateInviteCode } from "@/lib/utils";
import { notify } from "@/lib/realtime/notify";
import { channels } from "@/lib/realtime/channels";

// ============================================================
// SCHEMAS
// ============================================================

const openTableSchema = z.object({
  tableId: z.string().uuid(),
  title: z.string().min(1).max(80).optional(),
  visibility: z.enum(["public", "friends", "invite_only"]),
  vibeTags: z.array(z.string()).max(5).optional(),
  maxGuests: z.number().int().positive().optional(),
});

const addOrderItemSchema = z.object({
  sessionId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  quantity: z.number().int().positive().max(20),
  notes: z.string().max(200).optional(),
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
  ]);
}

// ============================================================
// SESSION LIFECYCLE
// ============================================================

export async function openTable(input: z.infer<typeof openTableSchema>) {
  const profile = await requireProfile();
  const data = openTableSchema.parse(input);

  // 1. Verify table aktif
  const [table] = await db
    .select({
      id: tables.id,
      capacity: tables.capacity,
      is_active: tables.isActive,
    })
    .from(tables)
    .where(eq(tables.id, data.tableId));
  if (!table) throw new Error("Table not found");
  if (!table.is_active) throw new Error("Table is not active");

  // 2-5: transaction — session + first member (host) + open order + invite code
  let sessionId: string;
  try {
    sessionId = await db.transaction(async (tx) => {
      const [newSession] = await tx
        .insert(tableSessions)
        .values({
          tableId: data.tableId,
          hostId: profile.id,
          status: "open",
          visibility: data.visibility,
          title: data.title ?? null,
          vibeTags: data.vibeTags ?? [],
          maxGuests: data.maxGuests ?? table.capacity,
        })
        .returning({ id: tableSessions.id });

      await tx.insert(sessionMembers).values({
        sessionId: newSession.id,
        profileId: profile.id,
        role: "host",
        status: "joined",
      });

      await tx.insert(orders).values({
        sessionId: newSession.id,
        status: "open",
      });

      await tx.insert(sessionInvites).values({
        sessionId: newSession.id,
        code: generateInviteCode(),
        createdBy: profile.id,
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

  await notifySessionAndStaff(sessionId);
  revalidatePath("/bar/[slug]", "page");
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

export async function closeSession(sessionId: string) {
  const profile = await requireProfile();

  const [session] = await db
    .select({ host_id: tableSessions.hostId })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  if (!session) throw new Error("Session not found");
  if (session.host_id !== profile.id) {
    throw new Error("Hanya host yang bisa menutup meja");
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
  redirect(`/session/${sessionId}/rate`);
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

  // 1. Find member
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
    addedByMemberId: member.id,
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

export async function payShare(input: z.infer<typeof paySchema>) {
  const profile = await requireProfile();
  const data = paySchema.parse(input);

  // 1. Member lookup
  const [member] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
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

  // Demo mode: auto-mark paid kalau bukan production
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  const autoPaid = demoMode || data.method === "mock";

  await db.insert(payments).values({
    orderId: order.id,
    paidByMemberId: member.id,
    amount: data.amount,
    method: data.method,
    status: autoPaid ? "paid" : "pending",
    splitMode: data.splitMode,
    splitMeta: data.splitMeta ?? {},
    paidAt: autoPaid ? new Date() : null,
  });

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
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
      hobbies,
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
}
