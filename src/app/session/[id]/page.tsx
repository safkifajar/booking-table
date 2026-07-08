import { notFound, redirect } from "next/navigation";
import { and, eq, desc, asc, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
  sessionInvites,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { orders, orderItems, payments } from "@/lib/db/schema/orders";
import { menuItems } from "@/lib/db/schema/menu";
import { getCurrentProfile, getStaffRole } from "@/lib/auth-v2/current";
import {
  getMenuByBar,
  flattenMenuTree,
  getUserRatingsBatch,
  promoteSessionIfDue,
} from "@/lib/queries";
import { defaultDashboardFor } from "@/lib/auth-v2/permissions";
import { getMyPendingMove } from "@/lib/move-approval-actions";
import { getSessionDetailForCashier } from "@/lib/cashier-actions";
import { SessionView } from "./SessionView";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}

/** Path internal aman utk back (cegah open-redirect): harus "/x", bukan "//x". */
function safeInternalPath(p: string | undefined): string | null {
  if (!p) return null;
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  return p;
}

export default async function SessionPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { from } = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/session/${id}`)}`);
  }
  // Staff (kasir/waiter/admin) BUKAN customer sosial — jangan paksa isi
  // onboarding customer (foto/minat/dll). Mereka buka session utk bantu tamu
  // (buka meja, bantu pesan), bukan pakai fitur sosial. Onboarding hanya utk
  // customer asli. Reuse staffRole di bawah utk back button (satu query).
  const staffRole = (await getStaffRole())?.role ?? null;
  if (!staffRole && !profile.onboarded)
    redirect(
      `/onboarding?next=${encodeURIComponent(`/session/${id}`)}`
    );

  // Promote reservasi yg jamnya sudah tiba → 'open' (lazy, supaya status fresh
  // saat buka session — denah & tombol gabung bergantung status open).
  await promoteSessionIfDue(id);

  // 1. Session + table + area + bar + host (single join)
  const [sessionRow] = await db
    .select({
      id: tableSessions.id,
      title: tableSessions.title,
      status: tableSessions.status,
      visibility: tableSessions.visibility,
      vibe_tags: tableSessions.vibeTags,
      started_at: tableSessions.startedAt,
      reservation_at: tableSessions.reservationAt,
      reservation_end_at: tableSessions.reservationEndAt,
      host_id: tableSessions.hostId,
      opened_by_staff_id: tableSessions.openedByStaffId,
      // table
      table_label: tables.label,
      table_capacity: tables.capacity,
      table_shape: tables.shape,
      table_allow_over_capacity: tables.allowOverCapacity,
      // area
      area_name: floorAreas.name,
      // bar
      bar_id: bars.id,
      bar_name: bars.name,
      bar_slug: bars.slug,
      // host profile
      host_display_name: profiles.displayName,
      host_avatar_url: profiles.avatarUrl,
    })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .innerJoin(profiles, eq(profiles.id, tableSessions.hostId))
    .where(eq(tableSessions.id, id));

  if (!sessionRow) notFound();

  // Lookup nama staff yang buka meja (untuk display "Dibuka oleh Waiter X")
  let openedByStaff: { id: string; display_name: string } | null = null;
  if (sessionRow.opened_by_staff_id) {
    const [staffProfile] = await db
      .select({ id: profiles.id, display_name: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.id, sessionRow.opened_by_staff_id));
    if (staffProfile) {
      openedByStaff = staffProfile;
    }
  }

  // 2. Members + their profile info (join)
  const membersRaw = await db
    .select({
      id: sessionMembers.id,
      role: sessionMembers.role,
      status: sessionMembers.status,
      joined_at: sessionMembers.joinedAt,
      invited_by: sessionMembers.invitedBy,
      profile_id: profiles.id,
      profile_display_name: profiles.displayName,
      profile_avatar_url: profiles.avatarUrl,
      profile_hobbies: profiles.hobbies,
    })
    .from(sessionMembers)
    .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
    .where(eq(sessionMembers.sessionId, id))
    .orderBy(asc(sessionMembers.joinedAt));

  // 3. Order sesi (single per session). JANGAN buang yg status 'closed':
  // saat meja ditutup, order ikut jadi closed — tapi bill-nya HARUS tetap
  // tampil (mis. overdue/belum lunas perlu lihat & lunasi tagihan). Tanpa ini
  // subtotal jadi 0 setelah tutup meja.
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.sessionId, id));

  // 4. Order items (kalau ada order) — with menu_item + member profile
  const orderItemsRaw = order
    ? await db
        .select({
          id: orderItems.id,
          quantity: orderItems.quantity,
          unit_price: orderItems.unitPrice,
          notes: orderItems.notes,
          status: orderItems.status,
          created_at: orderItems.createdAt,
          queue_number: orderItems.queueNumber,
          // menu_item
          menu_item_id: menuItems.id,
          menu_item_name: menuItems.name,
          menu_item_image_url: menuItems.imageUrl,
          // member + member's profile
          member_id: sessionMembers.id,
          member_profile_id: profiles.id,
          member_display_name: profiles.displayName,
          member_avatar_url: profiles.avatarUrl,
        })
        .from(orderItems)
        .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
        .innerJoin(
          sessionMembers,
          eq(sessionMembers.id, orderItems.addedByMemberId)
        )
        .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
        .where(
          and(eq(orderItems.orderId, order.id), ne(orderItems.status, "void"))
        )
        .orderBy(asc(orderItems.createdAt))
    : [];

  // 5. Payments (kalau ada order)
  const paymentsRaw = order
    ? await db
        .select({
          id: payments.id,
          amount: payments.amount,
          method: payments.method,
          status: payments.status,
          split_mode: payments.splitMode,
          paid_at: payments.paidAt,
          paid_by_display_name: profiles.displayName,
          paid_by_avatar_url: profiles.avatarUrl,
        })
        .from(payments)
        .innerJoin(
          sessionMembers,
          eq(sessionMembers.id, payments.paidByMemberId)
        )
        .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
        .where(eq(payments.orderId, order.id))
    : [];

  // 6. Menu — bentuk flat (sub-kategori + parent_name) utk picker order.
  const menu = flattenMenuTree(await getMenuByBar(sessionRow.bar_id));

  // 7. Latest invite
  const [invite] = await db
    .select({ code: sessionInvites.code, expires_at: sessionInvites.expiresAt })
    .from(sessionInvites)
    .where(eq(sessionInvites.sessionId, id))
    .orderBy(desc(sessionInvites.createdAt))
    .limit(1);

  const isHost = sessionRow.host_id === profile.id;
  const myMember = membersRaw.find((m) => m.profile_id === profile.id);
  const isMember = !!myMember && myMember.status === "joined";

  // staffRole sudah diambil di atas (via getStaffRole) — kalau staff, back
  // button arah ke dashboard role-nya (bukan ke /bar/[slug] customer landing).
  // Untuk waiter, default ke tab "Meja Aktif" (lebih relevan setelah dari session)
  const defaultBack = staffRole
    ? staffRole === "waiter"
      ? "/staff/waiter?tab=sessions"
      : defaultDashboardFor(staffRole)
    : `/bar/${sessionRow.bar_slug}`;
  // ?from= override (mis. datang dari booking/floor atau profil network) —
  // hanya path internal aman. Berlaku utk SEMUA peran: staff/admin yg lagi
  // jadi customer (booking sendiri) tetap balik ke asalnya, bukan dashboard.
  // Kalau tak ada from, fallback ke default (dashboard utk staff, /bar utk
  // customer).
  const backHref = safeInternalPath(from) ?? defaultBack;

  // Rating batch untuk semua members
  const memberProfileIds = membersRaw.map((m) => m.profile_id);
  const ratingsBatch = await getUserRatingsBatch(memberProfileIds);

  // Request pindah meja yg menunggu (badge realtime — ikut router.refresh).
  const pendingMove =
    isHost &&
    (sessionRow.status === "open" || sessionRow.status === "locked")
      ? await getMyPendingMove(sessionRow.id)
      : null;

  // Cashier: sediakan detail bill/payment lengkap utk panel pembayaran kasir
  // di tab Pay (kalkulator kembalian, QRIS, mark-paid/cancel, close→receipt).
  const cashierDetail =
    !isMember && staffRole === "cashier"
      ? await getSessionDetailForCashier(id)
      : null;

  return (
    <SessionView
      session={{
        id: sessionRow.id,
        title: sessionRow.title,
        status: sessionRow.status,
        visibility: sessionRow.visibility,
        vibe_tags: sessionRow.vibe_tags ?? [],
        started_at: sessionRow.started_at.toISOString(),
        reservation_at: sessionRow.reservation_at?.toISOString() ?? null,
        reservation_end_at:
          sessionRow.reservation_end_at?.toISOString() ?? null,
        host_id: sessionRow.host_id,
      }}
      table={{
        label: sessionRow.table_label,
        capacity: sessionRow.table_capacity,
        shape: sessionRow.table_shape,
        allowOverCapacity: sessionRow.table_allow_over_capacity,
      }}
      areaName={sessionRow.area_name}
      bar={{ name: sessionRow.bar_name, slug: sessionRow.bar_slug }}
      host={{
        id: sessionRow.host_id,
        display_name: sessionRow.host_display_name,
        avatar_url: sessionRow.host_avatar_url,
      }}
      members={membersRaw.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        joined_at: m.joined_at.toISOString(),
        invited_by: m.invited_by,
        profile: {
          id: m.profile_id,
          display_name: m.profile_display_name,
          avatar_url: m.profile_avatar_url,
          hobbies: m.profile_hobbies,
        },
        rating: ratingsBatch[m.profile_id] ?? null,
      }))}
      orderItems={orderItemsRaw.map((oi) => ({
        id: oi.id,
        quantity: oi.quantity,
        unit_price: oi.unit_price,
        notes: oi.notes,
        status: oi.status,
        created_at: oi.created_at.toISOString(),
        queue_number: oi.queue_number,
        menu_item: {
          id: oi.menu_item_id,
          name: oi.menu_item_name,
          image_url: oi.menu_item_image_url,
        },
        added_by: {
          member_id: oi.member_id,
          profile_id: oi.member_profile_id,
          display_name: oi.member_display_name,
          avatar_url: oi.member_avatar_url,
        },
      }))}
      payments={paymentsRaw.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        split_mode: p.split_mode,
        paid_at: p.paid_at ? p.paid_at.toISOString() : null,
        paid_by: p.paid_by_display_name,
        paid_by_avatar: p.paid_by_avatar_url,
      }))}
      menu={menu}
      myProfileId={profile.id}
      myMemberId={myMember?.id ?? null}
      isHost={isHost}
      isMember={isMember}
      inviteCode={invite?.code ?? null}
      backHref={backHref}
      staffRole={!isMember ? staffRole : null}
      openedByStaff={openedByStaff}
      pendingMove={pendingMove}
      cashierDetail={cashierDetail}
    />
  );
}
