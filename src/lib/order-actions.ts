"use server";

/**
 * Server Actions untuk PESANAN — menambah item, membuat order, membaca
 * daftar & detailnya, dan membuang item.
 *
 * Dipisah dari actions.ts sebagai bagian pemecahan berkas 5.208 baris itu.
 * Batasnya diambil dari blok "ORDER ITEMS" yang memang sudah berdiri
 * sendiri: lima fungsi di bawah cuma berbagi satu skema (addOrderItemSchema)
 * dan pembantu lintas-bagian yang sudah lebih dulu pindah ke
 * session-shared.ts.
 *
 * Perhatikan berkas ini bertanda "use server": Next.js melarangnya
 * mengekspor apa pun selain fungsi async — skema Zod di bawah sengaja TIDAK
 * diekspor.
 */

import { revalidatePath } from "next/cache";
import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
  desc,
} from "drizzle-orm";
import { alias as aliasedTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { menuItems } from "@/lib/db/schema/menu";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { staffRoles } from "@/lib/db/schema/extras";
import { profiles } from "@/lib/db/schema/profiles";
import { requireProfile } from "@/lib/auth-v2/current";
import {
  can,
  defaultDashboardFor,
  type StaffRoleName,
} from "@/lib/auth-v2/permissions";
import { isSessionHost } from "@/lib/auth-v2/session-auth";
import { formatIDR } from "@/lib/utils";
import { logActivity } from "@/lib/activity-log";
import { notifySessionAndStaff } from "@/lib/session-shared";
import {
  getOutstandingMap,
  getOrderOutstanding,
  settleOrderIfPaid,
} from "@/lib/queries";
import { computeBillTotals } from "@/lib/settings-constants";
import { getChargeConfig } from "@/lib/settings-actions";
import type { SessionOrderSummary, OrderDetail } from "@/lib/order-types";

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
      throw new Error("Only staff can input on behalf of a guest");
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
      throw new Error("Target member not found at this table");
    }

    memberId = targetMember.id;
    inputByStaffId = profile.id;
  } else {
    // Customer flow: HANYA host meja yang boleh menambah pesanan (bukan
    // sekadar member). Sumber kebenaran host = table_sessions.host_id.
    if (!(await isSessionHost(data.sessionId, profile.id))) {
      throw new Error("Only the table host can add orders");
    }
    // Host tetap butuh member row-nya untuk atribusi item (addedByMemberId).
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
    if (!member) throw new Error("You're not a member of this table");
    memberId = member.id;

    // Pay-before-order (jalur customer/host saja — staff dikecualikan, gate ini
    // ada di dalam cabang customer). Kalau masih ada sisa tagihan yang BELUM
    // lunas, host harus melunasinya dulu sebelum menambah pesanan. Hanya
    // pembayaran status 'paid' yang mengurangi outstanding (pending tak
    // membuka gate). (PRD Order Control FR4/FR5.)
    const outstanding =
      (await getOutstandingMap([data.sessionId])).get(data.sessionId) ?? 0;
    if (outstanding > 0) {
      throw new Error(
        `Please settle the outstanding Rp ${outstanding.toLocaleString(
          "id-ID"
        )} before adding more orders`
      );
    }
  }

  // 2. Find open order — HARUS order MEJA (owner NULL). Sejak anggota bisa
  //    punya ordernya sendiri, tanpa filter ini item bisa nyasar ke order
  //    pribadi anggota (dia yang tertagih, atau item masuk dapur tanpa tagihan
  //    kalau ordernya sudah lunas). Urutkan supaya pilihannya deterministik.
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.sessionId, data.sessionId),
        ne(orders.status, "closed"),
        ne(orders.status, "cancelled"),
        isNull(orders.ownerMemberId)
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (!order) throw new Error("No open order for this session");

  // 3. Menu item snapshot
  const [item] = await db
    .select({
      price: menuItems.price,
      is_available: menuItems.isAvailable,
      name: menuItems.name,
    })
    .from(menuItems)
    .where(eq(menuItems.id, data.menuItemId));
  if (!item) throw new Error("Menu item not found");
  if (!item.is_available) throw new Error("Menu item is currently unavailable");

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

  // Audit: HANYA kalau staff yang menginput atas nama tamu. Order yang
  // customer input sendiri bukan aktivitas staff, jadi tak dicatat.
  if (inputByStaffId) {
    const [loc] = await db
      .select({ barId: floorAreas.barId, tableLabel: tables.label })
      .from(tableSessions)
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
      .where(eq(tableSessions.id, data.sessionId));
    if (loc) {
      await logActivity({
        actorId: inputByStaffId,
        barId: loc.barId,
        action: "order.item_added_for_guest",
        category: "order",
        entityType: "order",
        entityId: order.id,
        summary: `Added ${data.quantity}x ${item.name} for a guest at table ${loc.tableLabel}`,
        meta: {
          itemName: item.name,
          quantity: data.quantity,
          unitPrice: item.price,
          sessionId: data.sessionId,
          tableLabel: loc.tableLabel,
        },
      });
    }
  }

  await notifySessionAndStaff(data.sessionId);
  revalidatePath(`/session/${data.sessionId}`);
}

const createOrderSchema = z.object({
  sessionId: z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().positive().max(20),
        notes: z.string().max(200).optional(),
      })
    )
    .min(1)
    .max(50),
  onBehalfOfMemberId: z.string().uuid().optional(),
});

/**
 * Buat ORDER BARU dari cart (multi-order model). Tiap penambahan pesanan = order
 * terpisah berstatus 'unpaid' yang HARUS dibayar dulu baru "masuk" ke dapur/staff.
 *
 * - Auth: host meja (customer) ATAU staff aktif (atas nama meja).
 * - Guard (Q1): maks 1 order 'unpaid' per sesi — kalau masih ada order unpaid
 *   menggantung, tolak (harus lunas dulu).
 * - Item di-insert status 'draft' (belum masuk dapur; jadi 'sent' saat order paid).
 *
 * Return orderId supaya UI bisa arahkan ke halaman detail order utk bayar.
 * (PRD Multi-Order Prepaid FR3/FR5.)
 */
export async function createOrder(
  input: z.infer<typeof createOrderSchema>
): Promise<{ orderId: string }> {
  const profile = await requireProfile();
  const data = createOrderSchema.parse(input);

  // 1. Auth + tentukan member atribusi.
  let memberId: string;
  let inputByStaffId: string | null = null;
  /**
   * Pemilik order. NULL = order MEJA (host/staff) — perilaku lama, host tetap
   * punya split equally & treat. Terisi = order milik anggota: dia bayar penuh
   * sendiri, tanpa split.
   */
  let ownerMemberId: string | null = null;
  if (data.onBehalfOfMemberId) {
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true)));
    if (!staff) throw new Error("Only staff can input on behalf of a guest");
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
    if (!targetMember) throw new Error("Target member not found at this table");
    memberId = targetMember.id;
    inputByStaffId = profile.id;
  } else {
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
    if (!member) throw new Error("You're not a member of this table");
    memberId = member.id;
    // Anggota non-host boleh memesan, TAPI ordernya MILIK DIA: dia wajib
    // membayarnya sendiri (penuh, tanpa split). Host tetap seperti sebelumnya
    // — ordernya = order MEJA (owner NULL) dgn split equally & treat.
    if (!(await isSessionHost(data.sessionId, profile.id))) {
      ownerMemberId = member.id;
    }
  }

  // 2. Guard: tak boleh buat order baru kalau masih ada order BELUM LUNAS
  //    (unpaid ATAU order yg masih punya sisa/DP, outstanding > 0). Order closed
  //    diabaikan. (Revisi Q1: "belum lunas" mencakup sisa DP, bukan cuma unpaid.)
  //
  //    LINGKUP: hanya order dgn PEMILIK yang sama — persis mencerminkan dua
  //    unique index di DB. Order meja (owner NULL) dan order tiap anggota
  //    berdiri sendiri: order host tak boleh memblokir anggota, dan order
  //    anggota tak boleh memblokir meja atau anggota lain.
  const activeOrders = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(
      and(
        eq(orders.sessionId, data.sessionId),
        notInArray(orders.status, ["closed", "cancelled"]),
        ownerMemberId
          ? eq(orders.ownerMemberId, ownerMemberId)
          : isNull(orders.ownerMemberId)
      )
    );
  for (const o of activeOrders) {
    // Order 'unpaid' menghalangi APAPUN outstanding-nya — DB punya unique index
    // uq_unpaid_order_per_session (maks 1 unpaid per sesi). Tanpa cek status ini,
    // order DP yg outstanding-nya sudah 0 (DP menutup total) lolos guard lalu
    // INSERT menabrak constraint → error Server Component, bukan pesan rapi.
    // settleOrderIfPaid semestinya sudah menaikkannya jadi 'paid'; kalau masih
    // 'unpaid' di sini berarti ada yg belum tersettle — jangan dipaksa lanjut.
    if (o.status === "unpaid") {
      await settleOrderIfPaid(o.id); // coba settle dulu (mis. DP sudah lunas)
      const [fresh] = await db
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, o.id));
      if (fresh?.status === "unpaid") {
        throw new Error(
          "Please settle the previous order before creating a new one"
        );
      }
      continue;
    }
    const { outstanding } = await getOrderOutstanding(o.id);
    if (outstanding > 0) {
      throw new Error("Please settle the previous order before creating a new one");
    }
  }

  // 3. Snapshot harga menu (tolak item tak tersedia).
  const menuIds = [...new Set(data.items.map((i) => i.menuItemId))];
  const menuRows = await db
    .select({ id: menuItems.id, price: menuItems.price, is_available: menuItems.isAvailable })
    .from(menuItems)
    .where(inArray(menuItems.id, menuIds));
  const menuMap = new Map(menuRows.map((m) => [m.id, m]));
  for (const it of data.items) {
    const m = menuMap.get(it.menuItemId);
    if (!m) throw new Error("Menu item not found");
    if (!m.is_available) throw new Error("A selected menu item is currently unavailable");
  }

  // 4. Buat order baru 'unpaid' + item status 'draft' (belum masuk dapur).
  const orderId = await db.transaction(async (tx) => {
    const [newOrder] = await tx
      .insert(orders)
      .values({ sessionId: data.sessionId, status: "unpaid", ownerMemberId })
      .returning({ id: orders.id });
    await tx.insert(orderItems).values(
      data.items.map((it) => ({
        orderId: newOrder.id,
        menuItemId: it.menuItemId,
        addedByMemberId: memberId,
        inputByStaffId,
        quantity: it.quantity,
        unitPrice: menuMap.get(it.menuItemId)!.price,
        notes: it.notes ?? null,
        status: "draft" as const,
      }))
    );
    return newOrder.id;
  });

  // Audit: HANYA order yang dibuatkan staff atas nama tamu (order yang tamu
  // buat sendiri bukan aktivitas staff). Dicatat setelah transaksi commit.
  if (inputByStaffId) {
    const [loc] = await db
      .select({ barId: floorAreas.barId, tableLabel: tables.label })
      .from(tableSessions)
      .innerJoin(tables, eq(tables.id, tableSessions.tableId))
      .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
      .where(eq(tableSessions.id, data.sessionId));
    if (loc) {
      const totalQty = data.items.reduce((s, i) => s + i.quantity, 0);
      await logActivity({
        actorId: inputByStaffId,
        barId: loc.barId,
        action: "order.created_for_guest",
        category: "order",
        entityType: "order",
        entityId: orderId,
        summary: `Created an order of ${totalQty} item(s) for a guest at table ${loc.tableLabel}`,
        meta: {
          itemCount: data.items.length,
          totalQuantity: totalQty,
          sessionId: data.sessionId,
          tableLabel: loc.tableLabel,
        },
      });
    }
  }

  revalidatePath(`/session/${data.sessionId}`);
  return { orderId };
}


/**
 * Daftar order untuk sebuah sesi (multi-order). Tiap order dgn status, jumlah
 * item, total, outstanding. Dipakai tab Bill (list order). Terbaru dulu.
 * (PRD Multi-Order Prepaid FR12.)
 */
export async function getSessionOrders(
  sessionId: string
): Promise<SessionOrderSummary[]> {
  await requireProfile();
  // Alias: nama pemesan bisa datang dari dua jalur berbeda (pemilik order utk
  // order anggota, host meja utk order meja) — keduanya menyentuh `profiles`,
  // jadi wajib di-alias supaya tak bentrok.
  const ownerMember = aliasedTable(sessionMembers, "owner_member");
  const ownerProfile = aliasedTable(profiles, "owner_profile");
  const hostProfile = aliasedTable(profiles, "host_profile");
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      ownerMemberId: orders.ownerMemberId,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      barId: floorAreas.barId,
      itemCount: sql<number>`COALESCE(SUM(CASE WHEN ${orderItems.status} <> 'void' THEN ${orderItems.quantity} ELSE 0 END), 0)::int`,
      subtotal: sql<number>`COALESCE(SUM(CASE WHEN ${orderItems.status} <> 'void' THEN ${orderItems.quantity} * ${orderItems.unitPrice} ELSE 0 END), 0)::int`,
      paid: sql<number>`0`,
      // Nama pemesan: pemilik order (anggota), atau host meja utk order MEJA.
      orderedBy: sql<string | null>`COALESCE(owner_profile.display_name, host_profile.display_name)`,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .leftJoin(ownerMember, eq(ownerMember.id, orders.ownerMemberId))
    .leftJoin(ownerProfile, eq(ownerProfile.id, ownerMember.profileId))
    .leftJoin(hostProfile, eq(hostProfile.id, tableSessions.hostId))
    // Order 'cancelled' IKUT ditampilkan di list (tab Bill) — riwayat meja
    // jangan bolong: anggota/host perlu tahu ada pesanan yang batal (mis.
    // kedaluwarsa karena tak dibayar), bukan pesanan itu hilang tanpa jejak.
    // Badge statusnya yang membedakan; nominalnya tak masuk tagihan.
    .where(eq(orders.sessionId, sessionId))
    .groupBy(
      orders.id,
      floorAreas.barId,
      ownerProfile.displayName,
      hostProfile.displayName
    )
    .orderBy(desc(orders.createdAt));

  // Paid per order.
  const paidRows = await db
    .select({
      orderId: payments.orderId,
      paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(orders.sessionId, sessionId), eq(payments.status, "paid")))
    .groupBy(payments.orderId);
  const paidMap = new Map(paidRows.map((r) => [r.orderId, Number(r.paid)]));

  // Pending "pay at cashier" per order (non-DP) → expiresAt terdekat, utk badge
  // + countdown di list & deep-link ke halaman bayar.
  const cashierRows = await db
    .select({
      orderId: payments.orderId,
      splitMeta: payments.splitMeta,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(orders.sessionId, sessionId),
        eq(payments.status, "pending"),
        sql`(${payments.splitMeta} ->> 'payAtCashier')::boolean IS TRUE`,
        sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS NOT TRUE`
      )
    );
  const cashierExpiryMap = new Map<string, string>();
  for (const c of cashierRows) {
    const meta = (c.splitMeta as { expiresAt?: string | null } | null) ?? {};
    if (meta.expiresAt) cashierExpiryMap.set(c.orderId, meta.expiresAt);
  }

  // Charge config (single-tenant: 1 bar).
  const barId = rows[0]?.barId;
  const charge = barId ? await getChargeConfig(barId) : null;

  return rows.map((r) => {
    const bill = computeBillTotals(Number(r.subtotal), charge);
    const paid = paidMap.get(r.id) ?? 0;
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      itemCount: Number(r.itemCount),
      subtotal: bill.subtotal,
      total: bill.total,
      outstanding: Math.max(0, bill.total - paid),
      owner_member_id: r.ownerMemberId,
      ordered_by: r.orderedBy,
      cashier_pending_expires_at: cashierExpiryMap.get(r.id) ?? null,
    };
  });
}

/**
 * Detail satu ORDER dalam sesi (halaman detail order). Info + item + history
 * payment + izin bayar. qr_string hanya utk pemilik payment/staff.
 * (PRD Multi-Order Prepaid FR14.)
 */
export async function getOrderDetail(
  sessionId: string,
  orderId: string
): Promise<OrderDetail | null> {
  const profile = await requireProfile();

  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      ownerMemberId: orders.ownerMemberId,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      hostId: tableSessions.hostId,
      barId: floorAreas.barId,
    })
    .from(orders)
    .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(and(eq(orders.id, orderId), eq(orders.sessionId, sessionId)));
  if (!order) return null;

  const isHost = order.hostId === profile.id;
  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profile.id),
        eq(staffRoles.barId, order.barId),
        eq(staffRoles.isActive, true)
      )
    );
  const isStaff = !!staff;
  // "isCashier" = boleh terima pembayaran (cashier/manager/admin) — bukan cuma
  // role 'cashier'. Dulu manager/admin dianggap customer → melihat PaymentSheet
  // & ke layar tunggu "pay at cashier", padahal mereka kasirnya.
  const isCashier = can(staff?.role as StaffRoleName | undefined, "receive_payment");

  const [myMember] = await db
    .select({ id: sessionMembers.id })
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.profileId, profile.id),
        eq(sessionMembers.status, "joined")
      )
    );
  const myMemberId = myMember?.id ?? null;

  // Anggota joined (utk kasir pilih payer saat terima cash).
  const memberRows = await db
    .select({
      id: sessionMembers.id,
      profileId: sessionMembers.profileId,
      name: profiles.displayName,
      // Tamu walk-in (dibuatkan staff) tak punya akun/membership → tak
      // mungkin punya voucher. Dipakai UI utk sembunyikan input voucher.
      isGuest: profiles.isGuest,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined")))
    .orderBy(sessionMembers.joinedAt);
  // Nama host meja — dipakai sbg pemesan utk order MEJA (owner NULL).
  const hostName =
    memberRows.find((m) => m.profileId === order.hostId)?.name ?? null;

  // Items.
  const itemRows = await db
    .select({
      id: orderItems.id,
      name: menuItems.name,
      image_url: menuItems.imageUrl,
      quantity: orderItems.quantity,
      unit_price: orderItems.unitPrice,
      added_by: profiles.displayName,
    })
    .from(orderItems)
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .innerJoin(sessionMembers, eq(sessionMembers.id, orderItems.addedByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "void")))
    .orderBy(orderItems.createdAt);

  // Payments (history).
  const payRows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      split_mode: payments.splitMode,
      split_meta: payments.splitMeta,
      external_ref: payments.externalRef,
      created_at: payments.createdAt,
      paid_at: payments.paidAt,
      paid_by_member_id: payments.paidByMemberId,
      paid_by: profiles.displayName,
      paid_by_avatar: profiles.avatarUrl,
      paid_by_role: sessionMembers.role,
    })
    .from(payments)
    .innerJoin(sessionMembers, eq(sessionMembers.id, payments.paidByMemberId))
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(eq(payments.orderId, orderId))
    .orderBy(payments.createdAt);

  const charge = await getChargeConfig(order.barId);
  const subtotal = itemRows.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const bill = computeBillTotals(subtotal, charge);
  const paid = payRows
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, bill.total - paid);

  const [{ n: membersCount }] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.status, "joined")));

  // View-only: user login tapi BUKAN host/staff/member. Boleh lihat item meja
  // (biar tahu pesan apa) TAPI nominal, nama pemesan/pembayar, & data pembayaran
  // DI-REDAKSI di server (privasi sosial: siapa bayar berapa). Order 'cancelled'
  // tak perlu penanganan khusus di sini — memang tampil sbg detail biasa.
  const isViewOnly = !isHost && !isStaff && myMemberId === null;
  // Order milik si penonton sendiri (dia anggota yang memesan untuk dirinya).
  // Order MEJA (ownerMemberId NULL) tak pernah "milik" siapa pun.
  const isOwnOrder =
    order.ownerMemberId !== null && order.ownerMemberId === myMemberId;

  // Sisa yang BENAR-BENAR belum tertutup = outstanding − Σ(QRIS pending yg masih
  // hidup). Saat split sudah di-generate & sebagian anggota belum bayar, sisa itu
  // "sudah dipesan" QRIS mereka. Kalau host masih boleh menekan "Pay this order",
  // ia bisa membuat pembayaran yang tumpang-tindih → kalau dua-duanya dibayar,
  // LEBIH BAYAR. Jadi tombol bayar hanya aktif kalau masih ada ruang tak tertutup.
  const nowMs = Date.now();
  const pendingLive = payRows.reduce((sum, p) => {
    if (p.status !== "pending") return sum;
    const m =
      (p.split_meta as { expiresAt?: string | null } | null) ?? {};
    const exp = m.expiresAt ? new Date(m.expiresAt).getTime() : null;
    // Tanpa expiry → anggap masih hidup (konservatif).
    const alive = exp == null || exp > nowMs;
    return alive ? sum + p.amount : sum;
  }, 0);
  const uncovered = Math.max(0, outstanding - pendingLive);

  return {
    id: order.id,
    sessionId,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    subtotal: isViewOnly ? 0 : bill.subtotal,
    charge: isViewOnly ? 0 : bill.charge,
    chargePercent: bill.chargePercent,
    chargeLabel: bill.chargeLabel,
    total: isViewOnly ? 0 : bill.total,
    paid: isViewOnly ? 0 : paid,
    outstanding: isViewOnly ? 0 : outstanding,
    isHost,
    isStaff,
    isCashier,
    staffHome: staff ? defaultDashboardFor(staff.role as StaffRoleName) : null,
    // Kasir TETAP boleh menerima pembayaran (mis. tamu bayar tunai di meja kasir
    // walau QRIS-nya masih hidup) — ia punya kontrol & bisa membatalkan QRIS.
    // Pemilik order (anggota yang memesan sendiri) juga boleh membayar — tapi
    // hanya ordernya sendiri, dan penuh tanpa split (lihat isOwnOrder di UI).
    canPay:
      (isHost || isStaff || (isOwnOrder && myMemberId !== null)) &&
      (isCashier ? outstanding > 0 : uncovered > 0),
    /** Order ini milik si penonton (anggota memesan sendiri) → bayar penuh, tanpa split. */
    isOwnOrder,
    isMemberOrder: order.ownerMemberId !== null,
    // Nama pemesan: pemilik order (anggota) atau host utk order MEJA.
    // Di-redaksi utk view-only, sama seperti added_by per item.
    ordered_by: isViewOnly
      ? null
      : (order.ownerMemberId
          ? memberRows.find((m) => m.id === order.ownerMemberId)?.name
          : hostName) ?? null,
    viewOnly: isViewOnly,
    members: isViewOnly
      ? []
      : memberRows.map((m) => ({
          id: m.id,
          name: m.name,
          is_guest: m.isGuest,
        })),
    items: itemRows.map((i) => ({
      id: i.id,
      name: i.name,
      image_url: i.image_url,
      quantity: i.quantity,
      // Nominal & nama pemesan di-redaksi utk view-only.
      unit_price: isViewOnly ? 0 : i.unit_price,
      added_by: isViewOnly ? null : i.added_by,
    })),
    // View-only tak melihat riwayat pembayaran sama sekali.
    payments: isViewOnly
      ? []
      : payRows.map((p) => {
          const meta =
            (p.split_meta as { isDownPayment?: boolean; dpFull?: boolean; payAtCashier?: boolean; supersededByPaid?: boolean; qrString?: string | null; expiresAt?: string | null; confirmedByName?: string | null; processedByName?: string | null } | null) ?? {};
          const isMine = p.paid_by_member_id === myMemberId;
          return {
            id: p.id,
            amount: p.amount,
            method: p.method,
            status: p.status,
            split_mode: p.split_mode,
            // DP yang menutup seluruh tagihan bukan "deposit" — tampil sbg bill
            // biasa (badge "Bill"), bukan "DP", supaya tak membingungkan.
            is_down_payment: !!meta.isDownPayment && !meta.dpFull,
            pay_at_cashier: !!meta.payAtCashier,
            superseded: !!meta.supersededByPaid,
            created_at: p.created_at.toISOString(),
            paid_at: p.paid_at ? p.paid_at.toISOString() : null,
            paid_by: p.paid_by,
            paid_by_avatar: p.paid_by_avatar,
            paid_by_member_id: p.paid_by_member_id,
            paid_by_is_host: p.paid_by_role === "host",
            // Staf yang memproses. Dua jalur berbeda:
            // - confirmedByName: kasir mengkonfirmasi pembayaran pay-at-cashier
            // - processedByName: kasir/waiter yang MEMBUAT pembayarannya
            // Keduanya dijawab lewat satu field supaya UI tak perlu tahu
            // lewat jalur mana pembayaran itu masuk.
            confirmed_by: meta.confirmedByName ?? meta.processedByName ?? null,
            qr_string: isMine || isStaff ? meta.qrString ?? null : null,
            // Ikut aturan qr_string: hanya pemilik payment / staff.
            external_ref: isMine || isStaff ? p.external_ref ?? null : null,
            expires_at: meta.expiresAt ?? null,
          };
        }),
    membersCount: Number(membersCount),
    myMemberId,
  };
}

export async function removeOrderItem(itemId: string, sessionId: string) {
  const profile = await requireProfile();

  // Ownership: who added it (via member.profile_id)?
  const [item] = await db
    .select({
      id: orderItems.id,
      added_by_profile_id: sessionMembers.profileId,
      name: menuItems.name,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
    })
    .from(orderItems)
    .innerJoin(
      sessionMembers,
      eq(sessionMembers.id, orderItems.addedByMemberId)
    )
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .where(eq(orderItems.id, itemId));
  if (!item) throw new Error("Item not found");

  const [session] = await db
    .select({
      host_id: tableSessions.hostId,
      bar_id: floorAreas.barId,
      table_label: tables.label,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(eq(tableSessions.id, sessionId));

  // Boleh hapus HANYA staff aktif di bar (kasir/waiter). Customer/host TIDAK
  // boleh batalkan pesanan sendiri — harus lewat kasir/waiter.
  let allowed = false;
  if (session) {
    const [staff] = await db
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, profile.id),
          eq(staffRoles.barId, session.bar_id),
          eq(staffRoles.isActive, true)
        )
      );
    allowed = !!staff;
  }
  if (!allowed) {
    throw new Error("Only staff (cashier/waiter) can cancel an order item");
  }

  await db
    .update(orderItems)
    .set({ status: "void" })
    .where(eq(orderItems.id, itemId));

  // Audit: pembatalan item = aksi sensitif (barang hilang dari tagihan) dan
  // HANYA staff yang bisa melakukannya — wajib tercatat siapa pelakunya.
  await logActivity({
    actorId: profile.id,
    barId: session!.bar_id,
    action: "order.item_voided",
    category: "order",
    entityType: "order_item",
    entityId: itemId,
    summary: `Voided ${item.quantity}x ${item.name} (${formatIDR(
      item.quantity * item.unitPrice
    )}) at table ${session!.table_label}`,
    meta: {
      itemName: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      sessionId,
      tableLabel: session!.table_label,
    },
  });

  await notifySessionAndStaff(sessionId);
  revalidatePath(`/session/${sessionId}`);
}

