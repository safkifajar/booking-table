import { notFound, redirect } from "next/navigation";
import { and, eq, desc, asc, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tableSessions,
  sessionMembers,
} from "@/lib/db/schema/sessions";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { orders, orderItems, payments, paymentItems } from "@/lib/db/schema/orders";
import { menuItems } from "@/lib/db/schema/menu";
import { getCurrentProfile, getStaffRole } from "@/lib/auth-v2/current";
import {
  getMenuByBar,
  flattenMenuTree,
  getUserRatingsBatch,
  promoteSessionIfDue,
  expireDpIfOverdue,
  expireUnpaidMemberOrders,
} from "@/lib/queries";
import { defaultDashboardFor } from "@/lib/auth-v2/permissions";
import { getMyPendingMove } from "@/lib/move-approval-actions";
import { getSessionDetailForCashier } from "@/lib/cashier-actions";
import { getChargeConfig } from "@/lib/settings-actions";
import { getSessionOrders } from "@/lib/actions";
import {
  getEffectiveRankOf,
  getEffectiveRankMap,
  MEMBERSHIP_RANK,
  tierLabel,
} from "@/lib/membership";
import { getFriendIdSet } from "@/lib/friends";
import { SessionView } from "./SessionView";

/**
 * Halaman ini berubah terus (anggota, pesanan, pembayaran) & disegarkan
 * lewat SSE. Tanpa force-dynamic, router.refresh() mengambil ulang tapi
 * dapat salinan cache — tampilannya baru berubah setelah pengguna pindah
 * tab. Halaman realtime lain (denah bar, dasbor waiter) sudah memakainya.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; tab?: string }>;
}

/** Path internal aman utk back (cegah open-redirect): harus "/x", bukan "//x". */
function safeInternalPath(p: string | undefined): string | null {
  if (!p) return null;
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  return p;
}

export default async function SessionPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { from, tab } = await searchParams;
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

  // Batalkan booking yg DP-nya tak dibayar dalam 1 menit (lazy-expire). Cek
  // SEBELUM promote — booking hangus tak boleh jadi 'open'.
  await expireDpIfOverdue(id);

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
      dp_paid_at: tableSessions.dpPaidAt,
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

  // Blokir akses saat DP booking belum dibayar: host (yg booking) tak boleh
  // buka halaman detail sampai DP lunas — meja "terbooking dulu" tapi belum
  // aktif. Staff (kasir/waiter) TETAP boleh (bantu tamu). Host diarahkan ke
  // halaman lanjut-bayar (/booking/[id]/pay) yg menampilkan QRIS + countdown.
  if (
    (sessionRow.status === "reserved" || sessionRow.status === "open") &&
    sessionRow.dp_paid_at == null &&
    !staffRole &&
    sessionRow.host_id === profile.id
  ) {
    const [pendingDp] = await db
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        and(
          eq(orders.sessionId, id),
          eq(payments.status, "pending"),
          sql`(${payments.splitMeta} ->> 'isDownPayment')::boolean IS TRUE`
        )
      )
      .limit(1);
    if (pendingDp) {
      redirect(`/booking/${id}/pay`);
    }
  }

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
      left_at: sessionMembers.leftAt,
      invited_by: sessionMembers.invitedBy,
      profile_id: profiles.id,
      profile_display_name: profiles.displayName,
      profile_avatar_url: profiles.avatarUrl,
      profile_hobbies: profiles.hobbies,
      // Tamu walk-in (dibuatkan staff) vs pelanggan terdaftar — dipakai UI
      // utk menandai siapa yang punya akun (mis. bisa dikenai voucher).
      profile_is_guest: profiles.isGuest,
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
          split_meta: payments.splitMeta,
          created_at: payments.createdAt,
          paid_at: payments.paidAt,
          // Prasyarat visibilitas QR per-anggota (PRD Host-Only Payment FR9a):
          // klien perlu tahu payment ini milik member mana.
          paid_by_member_id: payments.paidByMemberId,
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

  // 5b. Payment items (rincian item per pembayaran itemized) — untuk riwayat
  // order-payment yang bisa di-expand. (PRD Order Control FR8/FR9.)
  const paymentItemsRaw = order
    ? await db
        .select({
          payment_id: paymentItems.paymentId,
          amount: paymentItems.amount,
          quantity: orderItems.quantity,
          name: menuItems.name,
        })
        .from(paymentItems)
        .innerJoin(payments, eq(payments.id, paymentItems.paymentId))
        .innerJoin(orderItems, eq(orderItems.id, paymentItems.orderItemId))
        .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
        .where(eq(payments.orderId, order.id))
    : [];
  // Group per payment.
  const itemsByPayment = new Map<
    string,
    { name: string; quantity: number; amount: number }[]
  >();
  for (const pi of paymentItemsRaw) {
    const arr = itemsByPayment.get(pi.payment_id) ?? [];
    arr.push({ name: pi.name, quantity: pi.quantity, amount: pi.amount });
    itemsByPayment.set(pi.payment_id, arr);
  }

  // 6. Menu — bentuk flat (sub-kategori + parent_name) utk picker order.
  const menu = flattenMenuTree(await getMenuByBar(sessionRow.bar_id));

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

  // Gating membership: anggota ber-tier LEBIH TINGGI dari viewer disamarkan
  // (foto diburamkan + nama diganti label tier). Dikecualikan: diri sendiri
  // & teman — sama seperti aturan di halaman Friends/Network.
  // Staff dilewati sepenuhnya: mereka perlu melihat siapa yang di meja.
  // profileId -> label tier pengganti nama ("VIP member"/"Premium member").
  const lockedLabels = new Map<string, string>();
  if (!staffRole && memberProfileIds.length > 0) {
    const [viewerRank, rankMap, myFriendIds] = await Promise.all([
      getEffectiveRankOf(profile.id),
      getEffectiveRankMap(memberProfileIds),
      getFriendIdSet(profile.id),
    ]);
    for (const pid of memberProfileIds) {
      if (pid === profile.id || myFriendIds.has(pid)) continue;
      const r = rankMap.get(pid) ?? MEMBERSHIP_RANK.basic;
      if (r > viewerRank) lockedLabels.set(pid, tierLabel(r));
    }
  }

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

  // Config pajak & service charge bar (untuk hitung total tagihan).
  const chargeConfig = await getChargeConfig(sessionRow.bar_id);

  // Lazy expiry (tanpa cron): order milik anggota yang tak kunjung dibayar
  // dibatalkan dulu — aturan "wajib langsung bayar". Harus SEBELUM
  // getSessionOrders supaya statusnya sudah 'cancelled' saat list dirender
  // (order batal tetap tampil di tab Bill sbg riwayat, tapi tak dihitung
  // sebagai tagihan).
  await expireUnpaidMemberOrders(id);

  // Multi-order: daftar order utk tab Bill (list order).
  const sessionOrdersRaw = await getSessionOrders(id);

  // View-only: user login tapi BUKAN member & BUKAN staff. Boleh lihat meja
  // pesan apa, tapi nominal DI-REDAKSI di server (bukan cuma disembunyikan di
  // client) supaya tak bocor lewat network response. Nama pembayar/pemesan &
  // detail order sensitif ditangani di halaman detail order (getOrderDetail).
  const isViewOnly = !isMember && !staffRole;
  const sessionOrders = isViewOnly
    ? sessionOrdersRaw.map((o) => ({
        ...o,
        subtotal: 0,
        total: 0,
        outstanding: 0,
        // Nama pemesan ikut di-redaksi — orang luar meja tak boleh tahu siapa
        // memesan apa (konsisten dgn redaksi added_by di detail order).
        ordered_by: null,
      }))
    : sessionOrdersRaw;

  return (
    <SessionView
      initialTab={tab}
      orders={sessionOrders}
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
        left_at: m.left_at ? m.left_at.toISOString() : null,
        invited_by: m.invited_by,
        profile: {
          id: m.profile_id,
          // Nama diganti label tier DI SERVER — nama asli tak terkirim ke
          // browser. Fotonya tetap dikirim (diburamkan di UI).
          display_name:
            lockedLabels.get(m.profile_id) ?? m.profile_display_name,
          avatar_url: m.profile_avatar_url,
          // Hobi disembunyikan: detail personal, tak cukup diburamkan.
          hobbies: lockedLabels.has(m.profile_id) ? [] : m.profile_hobbies,
          is_guest: m.profile_is_guest,
          locked: lockedLabels.has(m.profile_id),
        },
        rating: lockedLabels.has(m.profile_id)
          ? null
          : ratingsBatch[m.profile_id] ?? null,
      }))}
      orderItems={
        isViewOnly
          ? [] // Non-member tak menerima detail item (nominal & pemesan) mentah.
          : orderItemsRaw.map((oi) => ({
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
            }))
      }
      payments={
        isViewOnly
          ? [] // Non-member tak menerima data pembayaran (nominal & pembayar).
          : paymentsRaw.map((p) => {
              const meta =
                (p.split_meta as {
                  isDownPayment?: boolean;
                  qrString?: string | null;
                  expiresAt?: string | null;
                  batchId?: string | null;
                } | null) ?? {};
              // Visibilitas QR per-anggota (PRD Host-Only Payment FR9/FR11):
              // qr_string HANYA diserahkan ke pemiliknya. Anggota lain — termasuk
              // host — tak menerima QR anggota lain. Status & nominal ke semua member.
              const isMine = p.paid_by_member_id === (myMember?.id ?? null);
              return {
                id: p.id,
                amount: p.amount,
                method: p.method,
                status: p.status,
                split_mode: p.split_mode,
                is_down_payment: !!meta.isDownPayment,
                batch_id: meta.batchId ?? null,
                qr_string: isMine ? meta.qrString ?? null : null,
                expires_at: meta.expiresAt ?? null,
                created_at: p.created_at.toISOString(),
                paid_at: p.paid_at ? p.paid_at.toISOString() : null,
                paid_by_member_id: p.paid_by_member_id,
                paid_by: p.paid_by_display_name,
                paid_by_avatar: p.paid_by_avatar_url,
                items: itemsByPayment.get(p.id) ?? [],
              };
            })
      }
      menu={menu}
      myProfileId={profile.id}
      myMemberId={myMember?.id ?? null}
      isHost={isHost}
      isMember={isMember}
      backHref={backHref}
      staffRole={!isMember ? staffRole : null}
      openedByStaff={openedByStaff}
      pendingMove={pendingMove}
      cashierDetail={cashierDetail}
      chargeConfig={chargeConfig}
    />
  );
}
