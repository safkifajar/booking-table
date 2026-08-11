"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Users,
  Utensils,
  Receipt,
  Check,
  Lock,
  Globe,
  UserPlus,
  Crown,
  X,
  LogOut,
  Star,
  Sparkles,
  Loader2,
  Clock,
  MapPin,
  Quote,
  Pencil,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatIDR, initials, cn, getActionErrorMessage } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { PaymentConfetti } from "@/components/PaymentConfetti";
import type { SessionOrderSummary } from "@/lib/actions";
import {
  createOrder,
  closeSession,
  leaveSession,
  approveJoinRequest,
  rejectJoinRequest,
  inviteUsersToSession,
  cancelInvite,
  requestJoinSession,
} from "@/lib/actions";
import { staffAddGuestToTable } from "@/lib/waiter-actions";
import { useSessionRealtime } from "@/hooks/useSessionRealtime";
import { type MenuPickerCategory } from "@/components/menu/MenuPicker";
import { StaffMenuGrid } from "@/components/menu/StaffMenuGrid";
import { UserInvitePicker } from "@/components/session/UserInvitePicker";
import { PayAtCashierCountdown } from "@/components/session/PayAtCashierCountdown";
import { MoveTableButton } from "./MoveTableButton";
import { StaffMoveTableButton } from "@/components/staff/StaffMoveTableButton";
import type { CashierSessionDetail } from "@/lib/cashier-actions";
import {
  computeBillTotals,
  type ChargeConfig,
} from "@/lib/settings-constants";
import { EditTableInfoModal } from "./EditTableInfoModal";
import type { InviteCandidate } from "@/lib/customer-actions";
import type {
  MemberRole,
  MemberStatus,
  SessionStatus,
  SessionVisibility,
  TableShape,
  OrderItemStatus,
  PaymentMethod,
  PaymentStatus,
  SplitMode,
} from "@/types/db";

type Tab = "vibe" | "menu" | "bill";

/** Jam "HH:MM" dari ISO string (waktu lokal). */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/** Tanggal singkat, mis. "Sat, 5 Jul". */
function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

interface SessionViewProps {
  session: {
    id: string;
    title: string | null;
    status: SessionStatus;
    visibility: SessionVisibility;
    vibe_tags: string[];
    started_at: string;
    reservation_at: string | null;
    reservation_end_at: string | null;
    host_id: string;
  };
  table: {
    label: string;
    capacity: number;
    shape: TableShape;
    allowOverCapacity: boolean;
  };
  areaName: string;
  bar: { name: string; slug: string };
  host: { id: string; display_name: string; avatar_url: string | null };
  members: Array<{
    id: string;
    role: MemberRole;
    status: MemberStatus;
    joined_at: string;
    /** Kapan keluar/dikeluarkan (null kalau masih di meja). */
    left_at: string | null;
    /** Terisi = diundang host (user yg approve). NULL + pending = request-join. */
    invited_by: string | null;
    profile: {
      id: string;
      display_name: string;
      avatar_url: string | null;
      hobbies?: string[];
      /** true = tamu walk-in tanpa akun (dibuatkan staff saat Open Table). */
      is_guest?: boolean;
    };
    rating: { avg_stars: number; rating_count: number; top_tags: string[] | null } | null;
  }>;
  orderItems: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    notes: string | null;
    status: OrderItemStatus;
    created_at: string;
    queue_number: number | null;
    menu_item: { id: string; name: string; image_url: string | null };
    added_by: {
      member_id: string;
      profile_id: string;
      display_name: string;
      avatar_url: string | null;
    };
  }>;
  payments: Array<{
    id: string;
    amount: number;
    method: PaymentMethod;
    status: PaymentStatus;
    split_mode: SplitMode;
    is_down_payment: boolean;
    batch_id: string | null;
    qr_string: string | null;
    expires_at: string | null;
    created_at: string;
    paid_at: string | null;
    paid_by_member_id: string;
    paid_by: string;
    paid_by_avatar: string | null;
    items: { name: string; quantity: number; amount: number }[];
  }>;
  /** Multi-order: daftar order sesi (tab Bill = list order). Terbaru dulu. */
  orders: SessionOrderSummary[];
  menu: MenuPickerCategory[];
  myProfileId: string;
  myMemberId: string | null;
  isHost: boolean;
  isMember: boolean;
  /**
   * URL untuk back button. Default `/bar/${slug}` (customer landing).
   * Untuk staff: arah ke dashboard role-nya (`/staff/waiter`, `/staff/cashier`, dst).
   */
  backHref: string;
  /**
   * Kalau current user adalah staff (waiter/cashier/manager/admin) DAN bukan
   * member meja, set ke role-nya. Staff bisa input order atas nama member,
   * kelola payment, dll meskipun bukan member.
   */
  staffRole: "admin" | "manager" | "cashier" | "waiter" | null;
  /**
   * Info "siapa staff yang buka meja ini" — null untuk session customer regular.
   * Display sebagai badge "Dibuka oleh Waiter X" di header.
   */
  openedByStaff: { id: string; display_name: string } | null;
  /** Request pindah meja yg menunggu approval (badge realtime). */
  pendingMove: { id?: string; toLabel: string; reservationAt: string } | null;
  /**
   * Detail bill/payment lengkap untuk panel kasir di tab Pay (hanya diisi saat
   * viewer = cashier & bukan member). null utk selain itu.
   */
  cashierDetail: CashierSessionDetail | null;
  /** Config pajak & service charge bar (untuk hitung total tagihan). */
  chargeConfig: ChargeConfig;
  /** Tab awal dari ?tab= (mis. kembali dari detail order → "bill"). */
  initialTab?: string;
}

export function SessionView(props: SessionViewProps) {
  // Tab awal bisa ditentukan lewat ?tab= — dipakai saat kembali dari halaman
  // detail order supaya user mendarat lagi di tab Bill (asalnya dari list order
  // di sana), bukan terlempar ke Vibe.
  const [tab, setTab] = React.useState<Tab>(
    props.initialTab === "bill" || props.initialTab === "menu"
      ? props.initialTab
      : "vibe"
  );
  // Cart menu diangkat ke sini supaya TAK hilang saat pindah tab (MenuTab
  // unmount saat tab lain aktif).
  const [menuCart, setMenuCart] = React.useState<Record<string, number>>({});
  const router = useRouter();
  useSessionRealtime(props.session.id);

  // Arah animasi geser tab: 1 = konten baru masuk dari kanan (pindah ke tab
  // berikutnya), -1 = dari kiri (tab sebelumnya).
  const [slideDir, setSlideDir] = React.useState<1 | -1>(1);
  // Tab Pay dihapus — pembayaran kini ada di tab Bill. (PRD Bill-Centric Payment.)
  const TAB_ORDER: Tab[] = ["vibe", "menu", "bill"];
  // Ganti tab + set arah animasi berdasar posisi tab.
  function changeTab(next: Tab) {
    if (next === tab) return;
    setSlideDir(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1);
    setTab(next);
  }

  // Swipe kiri/kanan utk pindah tab (Table ↔ Menu ↔ Bill). Menu punya syarat
  // sendiri (lihat showMenuTab) — swipe ikut itu.
  const showMenuRef = React.useRef(false);
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  function goTab(dir: 1 | -1) {
    let idx = TAB_ORDER.indexOf(tab);
    // Cari tab berikutnya yg boleh diakses (skip Menu kalau disembunyikan).
    while (true) {
      idx += dir;
      const next = TAB_ORDER[idx];
      if (!next) return;
      if (next === "menu" && !showMenuRef.current) continue;
      changeTab(next);
      return;
    }
  }
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Swipe horizontal jelas (jarak cukup + lebih horizontal dari vertikal).
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTab(dx < 0 ? 1 : -1); // geser kiri → tab berikutnya; kanan → sebelumnya
  }

  // Staff (waiter/cashier/manager/admin) yang bukan member meja tetap bisa
  // interact dengan UI cart/payment. Order item akan attributed ke member
  // tujuan (default = host) dengan input_by_staff_id audit trail.
  const isStaff = !!props.staffRole;
  const canInteract = props.isMember || isStaff;
  // View-only: user login tapi BUKAN member & BUKAN staff. Boleh lihat list order
  // meja (biar tahu meja pesan apa) TANPA nominal & tanpa aksi. Nominal + nama
  // pembayar/pemesan sudah di-redaksi di server (page.tsx) utk peran ini.
  const viewOnly = !canInteract;
  // Tambah order = host, staff (atas nama meja), ATAU anggota biasa. Anggota
  // non-host memesan untuk DIRINYA SENDIRI: ordernya terpisah & wajib dia bayar
  // langsung (tanpa split). Host tetap seperti sebelumnya (order meja + split).
  const canOrder = canInteract;
  // Multi-order: ada order BELUM LUNAS milik LINGKUP INI → tak boleh buat order
  // baru. Lingkupnya harus sama dgn guard server & unique index DB: host/staff
  // dibatasi order MEJA (owner null), anggota dibatasi ordernya SENDIRI. Tanpa
  // pemisahan ini, order host memblokir anggota (dan sebaliknya).
  const myMemberId = props.myMemberId ?? null;
  const isTableScope = props.isHost || isStaff;
  const hasUnpaidOrder = props.orders.some(
    (o) =>
      o.status !== "closed" &&
      // Order batal tak pernah menghalangi pemesanan berikutnya (eksplisit —
      // outstanding-nya memang 0, tapi jangan bergantung pada itu).
      o.status !== "cancelled" &&
      o.outstanding > 0 &&
      (isTableScope
        ? o.owner_member_id === null
        : o.owner_member_id === myMemberId)
  );
  // Sesi sudah ditutup (lunas=closed / belum lunas=overdue). Saat ended: tak ada
  // lagi ajak/undang/tutup/minta-gabung — meja sudah selesai.
  const isEnded =
    props.session.status === "closed" || props.session.status === "overdue";
  // Booking dibatalkan → tak ada order/pembayaran; sembunyikan tab Menu & Pay.
  const isCancelled = props.session.status === "cancelled";
  // Tab MENU: hanya untuk yang bisa order (host/staff), tak cancelled, & meja
  // belum selesai (closed/overdue tak bisa order lagi → Menu disembunyikan).
  const showMenuTab = canOrder && !isCancelled && !isEnded;
  // Bill tampil utk member/staff (aksi penuh) DAN non-member view-only (list
  // order tanpa nominal). Kecuali sesi cancelled.
  const showBillTab = (canInteract || viewOnly) && !isCancelled;
  // Sinkronkan ref utk gating swipe (goTab dipanggil dari touch handler).
  React.useEffect(() => {
    showMenuRef.current = showMenuTab;
  }, [showMenuTab]);
  // Tab efektif: kalau tab aktif jadi tersembunyi (mis. meja ditutup live saat
  // di Menu), fallback ke Bill supaya konten tak kosong — dihitung saat render.
  const effTab: Tab = tab === "menu" && !showMenuTab ? "bill" : tab;
  // Default target member untuk staff input order = host meja
  const joinedMembers = React.useMemo(
    () => props.members.filter((m) => m.status === "joined"),
    [props.members]
  );
  const hostMember = React.useMemo(
    () => joinedMembers.find((m) => m.role === "host") ?? joinedMembers[0],
    [joinedMembers]
  );
  // Total meja = agregat SEMUA order (multi-order), bukan satu order saja.
  // Dulu ini dihitung dari props.orderItems/props.payments — sisa model
  // single-order lama: page.tsx cuma mengirim item+payment SATU order sesi,
  // jadi footer menampilkan "PAID Rp 0 / Rp 199.000" padahal meja punya
  // beberapa order dgn total & pembayaran lain. props.orders (SessionOrderSummary)
  // sudah berisi total/outstanding per order, sumber yang sama dgn list order
  // di tab Bill → angkanya konsisten.
  // Order 'cancelled' IKUT di props.orders (biar tampil di list sbg riwayat),
  // tapi WAJIB dikecualikan dari perhitungan tagihan — pesanan batal bukan utang.
  const billable = props.orders.filter((o) => o.status !== "cancelled");
  const billTotal = billable.reduce((acc, o) => acc + o.total, 0);
  const remaining = billable.reduce((acc, o) => acc + o.outstanding, 0);
  const totalPaid = Math.max(0, billTotal - remaining);
  const isLunas = billTotal > 0 && remaining === 0;

  // Auto-redirect member ke halaman rate HANYA saat meja BARU DITUTUP live
  // (status berubah closed sambil halaman terbuka), bukan saat membuka riwayat
  // yg SUDAH closed dari Session History — di history user cuma mau lihat
  // detail, jangan dipaksa ke rating (yg utk solo = popup "Solo session").
  // Status saat mount: kalau sudah closed dari awal → JANGAN redirect.
  const wasClosedOnMount = React.useRef(props.session.status === "closed");
  const redirectedToRate = React.useRef(false);
  React.useEffect(() => {
    if (
      !wasClosedOnMount.current && // baru ditutup live, bukan buka dari history
      props.session.status === "closed" &&
      props.isMember &&
      isLunas &&
      !redirectedToRate.current
    ) {
      redirectedToRate.current = true;
      router.replace(`/session/${props.session.id}/rate`);
    }
  }, [props.session.status, props.session.id, router, props.isMember, isLunas]);

  return (
    <main className="flex-1 pb-32">
      <PaymentConfetti trigger={isLunas} />
      {/* Header */}
      <SessionHeader {...props} />

      {/* Tab strip — DIAM (di luar area scroll konten). */}
      <div className="z-10 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-3xl mx-auto px-2">
          <div className="flex">
            <TabButton
              icon={<Users className="h-4 w-4" />}
              label="Table"
              active={effTab === "vibe"}
              onClick={() => changeTab("vibe")}
              alert={
                props.isHost &&
                // Alert kuning hanya untuk request-join (butuh aksi host).
                // Undangan menunggu (invited_by terisi) bukan tugas host.
                props.members.some(
                  (m) => m.status === "pending" && m.invited_by == null
                )
              }
            />
            {/* Menu: member/staff yg bisa pesan, booking tak dibatalkan, & meja
                belum selesai (closed/overdue tak bisa order lagi). */}
            {showMenuTab && (
              <TabButton
                icon={<Utensils className="h-4 w-4" />}
                label="Menu"
                active={effTab === "menu"}
                onClick={() => changeTab("menu")}
              />
            )}
            {/* Bill: item order + status + riwayat pembayaran + tombol Pay.
                Pembayaran kini terpusat di sini (tab Pay dihapus). */}
            {showBillTab && (
              <TabButton
                icon={<Receipt className="h-4 w-4" />}
                label="Bill"
                active={effTab === "bill"}
                onClick={() => changeTab("bill")}
              />
            )}
          </div>
        </div>
      </div>

      {/* Konten (notice + tab) — tinggi tetap (sisa layar antara tab strip &
          footer). Scroll ditangani PER-TAB (lihat wrapper di bawah) supaya
          header/tab strip benar-benar diam & tab Menu bisa search fixed +
          list scroll sendiri. Di tab Menu, SessionFooter disembunyikan → beri
          ruang lebih (footer Save order dari StaffMenuGrid ada di dalam). */}
      <div
        className={cn(
          "flex flex-col",
          effTab === "menu" ? "h-[calc(100dvh-8rem)]" : "h-[calc(100dvh-12rem)]"
        )}
      >

      {/* Tab content — swipe kiri/kanan pindah tab. overflow-x clip cegah scroll
          horizontal saat animasi. overscroll-x contain + touch-action pan-y →
          cegah swipe-back native (panah kembali saat geser dari tepi). Inner
          key={effTab} → remount + animasi slide sesuai arah (slideDir). */}
      <div
        className="flex-1 min-h-0 flex flex-col [overflow-x:clip] [overscroll-behavior-x:contain] [touch-action:pan-y]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
      <div
        key={effTab}
        className={cn(
          "flex-1 min-h-0 max-w-3xl w-full mx-auto px-4 sm:px-6",
          // Tab Menu mengatur scroll sendiri (search fixed + list scroll).
          // Tab lain scroll normal di kontainer ini. overflow-x-hidden +
          // touch-action pan-y + overscroll contain → cegah swipe-back native
          // (panah kembali saat geser kiri) di Bill/Pay/Table.
          effTab === "menu"
            ? "flex flex-col overflow-hidden pt-4 sm:pt-6"
            : "overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] [touch-action:pan-y] py-4 sm:py-6"
        )}
        style={{
          animation: `${slideDir === 1 ? "tab-slide-right" : "tab-slide-left"} 0.22s ease-out`,
        }}
      >
        {effTab === "vibe" && (
          <VibeTab {...props} isStaff={isStaff} isEnded={isEnded} />
        )}
        {effTab === "menu" && canOrder && (
          <MenuTab
            menu={props.menu}
            sessionId={props.session.id}
            canInteract={canOrder}
            isStaff={isStaff}
            hostMemberId={hostMember?.id ?? null}
            hasUnpaidOrder={hasUnpaidOrder}
            onOrderCreated={(orderId) =>
              router.push(`/session/${props.session.id}/order/${orderId}`)
            }
            cart={menuCart}
            onCartChange={setMenuCart}
          />
        )}
        {effTab === "bill" && (
          <BillTab
            orders={props.orders}
            sessionId={props.session.id}
            hideAmount={viewOnly}
          />
        )}
      </div>
      </div>
      </div>

      {/* Sticky bottom bar — DISEMBUNYIKAN di tab Menu karena tab Menu punya
          footer sendiri (Total order + Save order) yg mengalir di bawah list. */}
      {tab !== "menu" && (
      <SessionFooter
        total={billTotal}
        paid={totalPaid}
        remaining={remaining}
        isHost={props.isHost}
        isMember={canInteract}
        isStaff={isStaff}
        // Sesi cancelled juga "selesai" utk aksi tutup/keluar — tak ada lagi
        // yang bisa ditutup/ditinggalkan. (Server juga menolaknya.)
        isEnded={isEnded || isCancelled}
        sessionId={props.session.id}
      />
      )}
    </main>
  );
}

// ============================================================
// HEADER
// ============================================================

function SessionHeader(props: SessionViewProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={props.backHref} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-semibold truncate">
            {props.session.title ?? "Table Details"}
          </h1>
          {props.openedByStaff && (
            <div className="flex items-center gap-1 mt-0.5">
              <Sparkles className="h-3 w-3 text-primary/70" />
              <span className="text-[10px] text-primary/70">
                Walk-in · Opened by {props.openedByStaff.display_name}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function VisibilityIcon({ visibility }: { visibility: SessionVisibility }) {
  if (visibility === "public") return <Globe className="h-3 w-3 text-muted-foreground" />;
  if (visibility === "friends") return <UserPlus className="h-3 w-3 text-muted-foreground" />;
  return <Lock className="h-3 w-3 text-muted-foreground" />;
}

/** Badge status meja di kartu Table Information (pojok kanan). */
function TableStatusBadge({ status }: { status: SessionStatus }) {
  const map: Record<
    SessionStatus,
    { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }
  > = {
    open: { label: "In use", variant: "destructive" },
    locked: { label: "In use", variant: "destructive" },
    reserved: { label: "Reserved", variant: "default" },
    overdue: { label: "Unpaid", variant: "warning" },
    closed: { label: "Closed", variant: "secondary" },
    cancelled: { label: "Cancelled", variant: "secondary" },
  };
  const s = map[status] ?? { label: status, variant: "secondary" as const };
  return (
    <Badge variant={s.variant} className="text-[10px] px-1.5 shrink-0">
      {s.label}
    </Badge>
  );
}

/** Label visibility meja utk ditampilkan ke user. */
function visibilityLabel(visibility: SessionVisibility): string {
  if (visibility === "public") return "Public · anyone can join";
  if (visibility === "friends") return "Friends only";
  return "Invite only";
}

// ============================================================
// TABS
// ============================================================

function TabButton({
  icon,
  label,
  active,
  onClick,
  badge,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  alert?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition",
        active
          ? "text-primary border-primary"
          : "text-muted-foreground border-transparent hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          {badge}
        </span>
      )}
      {alert && (
        <span className="absolute top-2 right-2 sm:right-4 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
      )}
    </button>
  );
}

// VIBE / MEMBERS TAB
function VibeTab(
  props: SessionViewProps & { isStaff: boolean; isEnded: boolean }
) {
  const router = useRouter();
  const joined = props.members.filter((m) => m.status === "joined");
  // "Request masuk" = orang yang minta join sendiri (host yg approve) →
  // invited_by NULL. Yang DIUNDANG host (invited_by terisi) bukan request,
  // melainkan menunggu si user sendiri yang terima → tampil terpisah.
  const pending = props.members.filter(
    (m) => m.status === "pending" && m.invited_by == null
  );
  const invitedPending = props.members.filter(
    (m) => m.status === "pending" && m.invited_by != null
  );
  // Jejak anggota yang sudah TIDAK di meja (keluar sendiri / dikeluarkan staff).
  // Ala grup WA: tetap tampil sebagai riwayat, bukan hilang begitu saja — biar
  // jelas siapa saja yang pernah ikut di meja ini.
  const departed = props.members.filter(
    (m) => m.status === "left" || m.status === "kicked"
  );
  // Kalau meja izinkan over-capacity (setting admin), anggap selalu ADA slot
  // (host/staff boleh terus menambah orang walau lewat kapasitas). Angka
  // ditampilkan tetap kapasitas asli, tapi tombol ajak/tambah tak terkunci.
  const overCap = props.table.allowOverCapacity;
  const rawSlots = props.table.capacity - joined.length;
  const slotsAvailable = overCap ? Math.max(rawSlots, 99) : rawSlots;
  // Untuk ajak/undang: undangan yg belum dijawab (invitedPending) juga sudah
  // "memesan" slot, jadi tidak bisa over-invite. Mis. kapasitas 4, joined 3,
  // 1 undangan pending → 0 slot untuk undangan baru. (Diabaikan kalau overCap.)
  const inviteSlotsAvailable = overCap
    ? 99
    : slotsAvailable - invitedPending.length;
  const [addGuestModal, setAddGuestModal] = React.useState(false);
  const [inviteModal, setInviteModal] = React.useState(false);
  const [editInfoModal, setEditInfoModal] = React.useState(false);
  // Host / staff boleh edit info meja (deskripsi, visibility, vibe) selama
  // sesi belum berakhir.
  const canEditInfo = (props.isHost || props.isStaff) && !props.isEnded;
  // Tombol "Tambah Tamu" cuma muncul untuk staff di session walk-in
  // (yang dibuka oleh staff lewat opened_by_staff_id). Untuk session customer
  // reguler, tamu tambah lewat invite link.
  const canStaffAddGuest =
    props.isStaff && !!props.openedByStaff && slotsAvailable > 0;

  // Viewer non-host & non-staff yg melihat sesi PUBLIC yg sedang open boleh
  // minta gabung (host approve). Status member viewer saat ini:
  const myStatus =
    props.members.find((m) => m.profile.id === props.myProfileId)?.status ??
    null;
  const canRequestJoin =
    !props.isHost &&
    !props.isStaff &&
    !props.isMember &&
    myStatus !== "kicked" &&
    props.session.status === "open" &&
    props.session.visibility === "public";

  // Aksi pindah meja — host (request approval) / staff (langsung). Ditaruh di
  // dalam section Table Information (di bawah), bukan mengambang di atas.
  const canMoveTable =
    props.session.status === "reserved" ||
    props.session.status === "open" ||
    props.session.status === "locked";

  return (
    <div className="space-y-4">

      {/* Pending requests — host only */}
      {props.isHost && pending.length > 0 && (
        <PendingRequests sessionId={props.session.id} pending={pending} />
      )}

      {/* Undangan menunggu konfirmasi user — host only, TANPA tombol approve
          (yang menerima undangan adalah si user, bukan host). */}
      {props.isHost && invitedPending.length > 0 && (
        <InvitedPending
          invited={invitedPending}
          sessionId={props.session.id}
        />
      )}

      {/* Section 1: Table information */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Table information
          </h2>
          <TableStatusBadge status={props.session.status} />
        </div>
        <div className="space-y-2 text-sm">
          {/* Deskripsi (dari field opsional saat open table) — kalau ada. */}
          {props.session.title && (
            <div className="flex items-start gap-1.5 text-foreground">
              <Quote className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
              <span className="italic">{props.session.title}</span>
            </div>
          )}
          {/* Room / area + venue */}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>
              {props.areaName}
              <span className="text-muted-foreground/60">
                {" · "}
                {props.bar.name}
              </span>
            </span>
          </div>
          {/* Meja + kapasitas — mis. "Table T6 · 2 seats" */}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="text-foreground font-medium">
                Table {props.table.label}
              </span>
              <span className="text-muted-foreground/60">{" · "}</span>
              {props.table.capacity} seats
            </span>
          </div>
          {/* Visibility meja — public / friends / invite only. */}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <VisibilityIcon visibility={props.session.visibility} />
            <span>{visibilityLabel(props.session.visibility)}</span>
          </div>
          {/* Tanggal + jam booking (kalau reservasi, bukan walk-in). Kalau
              rentangnya lintas hari, tampilkan tanggal DI KEDUA sisi biar
              jelas (mis. "Fri 10 Jul 21:00 → Sat 11 Jul 03:00"). */}
          {props.session.reservation_at && (
            <div className="flex items-start gap-1.5 text-muted-foreground text-sm">
              <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {(() => {
                const start = props.session.reservation_at;
                const end = props.session.reservation_end_at;
                const crosses =
                  end &&
                  new Date(start).toDateString() !==
                    new Date(end).toDateString();
                if (end && crosses) {
                  return (
                    <span className="text-sm">
                      Booked {formatDateShort(start)} {formatTime(start)}
                      <span className="text-muted-foreground/60">{" – "}</span>
                      {formatDateShort(end)} {formatTime(end)}
                    </span>
                  );
                }
                return (
                  <span className="text-sm">
                    Booked {formatDateShort(start)}, {formatTime(start)}
                    {end ? `–${formatTime(end)}` : ""}
                  </span>
                );
              })()}
            </div>
          )}
          {/* Vibe tags — dipindah ke dalam info (dulu mengambang di atas). */}
          {props.session.vibe_tags.length > 0 && (
            <div className="flex items-start gap-1.5 text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="flex flex-wrap gap-1.5">
                {props.session.vibe_tags.map((v) => (
                  <Badge key={v} variant="secondary" className="text-xs">
                    {v}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Aksi meja — Move Table + Edit berdampingan (2 tombol). */}
        {(canEditInfo || canMoveTable) && (
          <div className="mt-4 pt-4 border-t border-border flex items-stretch gap-2">
            {/* Move table — host (request) / staff (langsung). */}
            {props.isHost && canMoveTable && (
              <div className="flex-1">
                <MoveTableButton
                  sessionId={props.session.id}
                  status={props.session.status}
                  menu={props.menu}
                  pendingMove={props.pendingMove}
                  existingOrderTotal={props.orderItems.reduce(
                    (acc, i) =>
                      i.status === "void"
                        ? acc
                        : acc + i.quantity * i.unit_price,
                    0
                  )}
                />
              </div>
            )}
            {!props.isHost && props.staffRole && canMoveTable && (
              <div className="flex-1">
                <StaffMoveTableButton sessionId={props.session.id} />
              </div>
            )}
            {/* Edit info meja — struktur sama (flex-1 wrapper + w-full Button)
                spy lebar & tinggi persis = Move Table. */}
            {canEditInfo && (
              <div className="flex-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setEditInfoModal(true)}
                >
                  <Pencil className="h-4 w-4" />
                  Edit info
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Section 2: People at table */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            People at table ({joined.length}/{props.table.capacity})
          </h2>
        </div>
        <div className="space-y-3">
          {joined.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              {/* Avatar → halaman profil user. */}
              <Link
                href={`/network/${m.profile.id}`}
                className="shrink-0 rounded-full transition hover:ring-2 hover:ring-primary/40"
                aria-label={`View ${m.profile.display_name}'s profile`}
              >
                <Avatar>
                  {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
                  <AvatarFallback>{initials(m.profile.display_name)}</AvatarFallback>
                </Avatar>
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-sm truncate">{m.profile.display_name}</p>
                  {m.role === "host" && (
                    <Crown className="h-3 w-3 text-primary" aria-label="Host" />
                  )}
                  {m.profile.id === props.myProfileId && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      you
                    </Badge>
                  )}
                  {/* Tamu walk-in tanpa akun. Ditandai yang TAMU (bukan yang
                      terdaftar) karena mayoritas anggota biasanya punya akun —
                      jadi badge tetap jarang & mudah dipindai kasir. */}
                  {m.profile.is_guest && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 text-muted-foreground"
                    >
                      guest
                    </Badge>
                  )}
                  {m.rating && m.rating.rating_count > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-primary">
                      <Star className="h-3 w-3 fill-primary" />
                      {m.rating.avg_stars}
                      <span className="text-muted-foreground">
                        ({m.rating.rating_count})
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Joined {formatDateShort(m.joined_at)},{" "}
                    {formatTime(m.joined_at)}
                  </span>
                  {m.rating?.top_tags && m.rating.top_tags.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="truncate">
                        {m.rating.top_tags.slice(0, 2).join(" · ")}
                      </span>
                    </>
                  )}
                </div>
                {m.profile.hobbies && m.profile.hobbies.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {m.profile.hobbies.slice(0, 4).map((h) => (
                      <span
                        key={h}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
                      >
                        {h}
                      </span>
                    ))}
                    {m.profile.hobbies.length > 4 && (
                      <span className="text-[10px] text-muted-foreground/60 px-1">
                        +{m.profile.hobbies.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {!props.isEnded &&
            slotsAvailable > 0 &&
            (canStaffAddGuest ? (
              <button
                type="button"
                onClick={() => setAddGuestModal(true)}
                className="w-full flex items-center gap-3 p-2 -m-2 rounded-md hover:bg-primary/5 transition group"
              >
                <div className="h-10 w-10 rounded-full border-2 border-dashed border-primary/40 group-hover:border-primary flex items-center justify-center transition">
                  <UserPlus className="h-4 w-4 text-primary" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-primary">
                    Add Guest
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {overCap
                      ? rawSlots > 0
                        ? `${rawSlots} empty seats`
                        : "Over capacity allowed"
                      : `${rawSlots} empty seats`}
                  </p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 opacity-50">
                <div className="h-10 w-10 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm">
                    {rawSlots > 0 ? `${rawSlots} empty seats` : "Table full"}
                  </p>
                </div>
              </div>
            ))}

          {/* Ajak/Undang user (host only) — 2 mode seperti open table.
              Sembunyikan kalau meja penuh / sudah ditutup. */}
          {props.isHost &&
            !props.isEnded &&
            (inviteSlotsAvailable > 0 ? (
              <button
                type="button"
                onClick={() => setInviteModal(true)}
                className="w-full flex items-center gap-3 pt-3 mt-1 border-t border-border text-left group"
              >
                <div className="h-10 w-10 rounded-full border-2 border-dashed border-primary/40 group-hover:border-primary flex items-center justify-center transition shrink-0">
                  <UserPlus className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-primary">
                    Invite people
                  </p>
                  <p className="text-xs text-muted-foreground">
                    They join once they accept
                  </p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 pt-3 mt-1 border-t border-border text-muted-foreground">
                <div className="h-10 w-10 rounded-full border-2 border-dashed border-border flex items-center justify-center shrink-0">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Table is full</p>
                  <p className="text-xs text-muted-foreground">
                    {invitedPending.length > 0
                      ? `${joined.length} at table + ${invitedPending.length} awaiting confirmation (capacity ${props.table.capacity})`
                      : `All ${props.table.capacity} seats taken`}
                  </p>
                </div>
              </div>
            ))}

          {/* Non-host & non-member: minta gabung ke meja public (host approve). */}
          {canRequestJoin && (
            <RequestJoinButton
              sessionId={props.session.id}
              hostName={props.host.display_name}
              full={slotsAvailable <= 0}
              alreadyPending={myStatus === "pending"}
            />
          )}

          {/* Jejak anggota yang sudah keluar — ala grup WA: tetap terlihat
              pernah ikut, tapi dibedakan (redup + tanpa hobi/rating). */}
          {departed.length > 0 && (
            <div className="pt-3 mt-1 border-t border-border space-y-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Left the table ({departed.length})
              </p>
              {departed.map((m) => (
                <div key={m.id} className="flex items-center gap-3 opacity-60">
                  <Link
                    href={`/network/${m.profile.id}`}
                    className="shrink-0 rounded-full transition hover:ring-2 hover:ring-primary/40"
                    aria-label={`View ${m.profile.display_name}'s profile`}
                  >
                    <Avatar className="grayscale">
                      {m.profile.avatar_url && (
                        <AvatarImage src={m.profile.avatar_url} />
                      )}
                      <AvatarFallback>
                        {initials(m.profile.display_name)}
                      </AvatarFallback>
                    </Avatar>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-sm truncate">
                        {m.profile.display_name}
                      </p>
                      {m.role === "host" && (
                        <Crown className="h-3 w-3 text-primary" aria-label="Host" />
                      )}
                      {m.profile.id === props.myProfileId && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          you
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {m.status === "kicked" ? "Removed" : "Left"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {m.left_at
                        ? `Left ${formatDateShort(m.left_at)}, ${formatTime(m.left_at)}`
                        : `Joined ${formatDateShort(m.joined_at)}, ${formatTime(m.joined_at)}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {inviteModal && (
        <InviteToSessionModal
          sessionId={props.session.id}
          visibility={props.session.visibility}
          onClose={() => setInviteModal(false)}
        />
      )}

      {addGuestModal && (
        <AddGuestModal
          sessionId={props.session.id}
          remainingSlots={slotsAvailable}
          onClose={() => setAddGuestModal(false)}
        />
      )}

      {editInfoModal && (
        <EditTableInfoModal
          sessionId={props.session.id}
          initialTitle={props.session.title}
          initialVisibility={props.session.visibility}
          initialVibes={props.session.vibe_tags}
          onClose={() => setEditInfoModal(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

// Modal: staff tambah tamu ke meja walk-in existing
function AddGuestModal({
  sessionId,
  remainingSlots,
  onClose,
}: {
  sessionId: string;
  remainingSlots: number;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || submitting) return;

    setSubmitting(true);
    try {
      await staffAddGuestToTable(sessionId, clean);
      toast.success(`Guest "${clean}" added`);
      onClose();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to add guest"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Add Guest to Table</h2>
              <p className="text-[11px] text-muted-foreground">
                {remainingSlots} empty seats
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label
              htmlFor="guestName"
              className="text-xs font-medium text-muted-foreground block mb-1.5"
            >
              Guest name
            </label>
            <input
              id="guestName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ms. Sari"
              maxLength={80}
              autoFocus
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded-md text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
          </div>

          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={!name.trim() || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Add Guest
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Modal: host mengundang user ke meja berjalan. SEMUA undangan perlu
 * persetujuan yg diundang (tak ada auto-join), dan kandidat mengikuti
 * visibility meja — "friends" hanya boleh mengundang teman.
 */
function InviteToSessionModal({
  sessionId,
  visibility,
  onClose,
}: {
  sessionId: string;
  visibility: SessionVisibility;
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<InviteCandidate[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit() {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await inviteUsersToSession({
        sessionId,
        userIds: selected.map((s) => s.id),
      });
      toast.success(`Invite sent to ${res.invited} people`);
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to invite"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Invite to Table</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            {visibility === "friends"
              ? "Friends-only table. You can invite your friends. They join once they accept."
              : "They join once they accept the invite."}
          </p>

          <UserInvitePicker
            visibility={visibility}
            selected={selected}
            onChange={setSelected}
            excludeSessionId={sessionId}
          />

          <Button
            type="button"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={selected.length === 0 || submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Invite {selected.length || ""} people
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// MENU TAB
function MenuTab({
  menu,
  sessionId,
  canInteract,
  isStaff,
  hostMemberId,
  hasUnpaidOrder,
  cart,
  onCartChange,
  onOrderCreated,
}: {
  menu: MenuPickerCategory[];
  sessionId: string;
  canInteract: boolean;
  isStaff: boolean;
  /** Member tujuan atribusi order waiter (default host meja). */
  hostMemberId: string | null;
  /** Ada order 'unpaid' menggantung → tak boleh buat order baru (Q1). */
  hasUnpaidOrder: boolean;
  /** Dipanggil dgn orderId setelah order baru dibuat (→ halaman detail order). */
  onOrderCreated?: (orderId: string) => void;
  /** Cart diangkat ke SessionView biar tak hilang saat pindah tab. */
  cart: Record<string, number>;
  onCartChange: (next: Record<string, number>) => void;
}) {
  if (!canInteract) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
        Join the table first to order.
      </Card>
    );
  }
  return (
    <div className="h-full flex flex-col min-h-0">
      {hasUnpaidOrder && (
        <Card className="p-4 mb-3 bg-amber-500/10 border-amber-500/30">
          <div className="text-sm font-semibold text-amber-500">
            Unpaid order pending
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Settle your previous order in the Bill tab before creating a new one.
          </div>
        </Card>
      )}
      <StaffMenuGrid
        menu={menu}
        cart={cart}
        onCartChange={onCartChange}
        saveLabel="Create order"
        onSave={async (cartLines) => {
          if (hasUnpaidOrder) {
            toast.error("Settle your previous order before creating a new one");
            return;
          }
          if (isStaff && !hostMemberId) {
            toast.error("Table has no host yet. Can't create the order");
            return;
          }
          try {
            // Multi-order: buat 1 order baru 'unpaid' dari cart → halaman detail
            // order utk bayar (baru masuk dapur setelah lunas).
            const { orderId } = await createOrder({
              sessionId,
              items: cartLines.map((l) => ({
                menuItemId: l.menuItemId,
                quantity: l.quantity,
              })),
              onBehalfOfMemberId: isStaff ? hostMemberId! : undefined,
            });
            onCartChange({});
            toast.success("Order created. Proceed to payment");
            onOrderCreated?.(orderId);
          } catch (err) {
            toast.error(getActionErrorMessage(err, "Failed to create order"));
          }
        }}
      />
    </div>
  );
}

// BILL TAB — LIST ORDER (multi-order). Tiap baris = 1 order → halaman detail.
// Untuk kasir: panel kasir kaya (accept/mark-paid/close). (PRD Multi-Order.)
function BillTab({
  orders,
  sessionId,
  hideAmount = false,
}: {
  orders: SessionOrderSummary[];
  sessionId: string;
  /** View-only non-member: sembunyikan nominal (biar cuma tahu meja pesan apa). */
  hideAmount?: boolean;
}) {
  // Semua peran (customer/kasir/waiter) melihat LIST ORDER yang sama. Aksi bayar
  // dilakukan lewat halaman detail order (kasir sbg staff tetap bisa). (Konsisten.)
  if (orders.length === 0) {
    return (
      <Card className="p-6 text-center border-dashed">
        <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          {hideAmount ? "No orders yet." : "No orders yet. Open the Menu tab to start ordering."}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <OrderList
        orders={orders}
        sessionId={sessionId}
        heading="Orders"
        hideAmount={hideAmount}
      />
    </div>
  );
}

/** List order — tiap baris = 1 order, klik → halaman detail order. */
function OrderList({
  orders,
  sessionId,
  heading,
  hideAmount = false,
}: {
  orders: SessionOrderSummary[];
  sessionId: string;
  heading: string;
  hideAmount?: boolean;
}) {
  const router = useRouter();
  if (orders.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{heading}</h3>
      <div className="space-y-2">
        {orders.map((o) => (
          <Link
            key={o.id}
            // Order menunggu bayar di kasir → langsung ke layar countdown; selain
            // itu ke detail order biasa.
            href={
              o.cashier_pending_expires_at
                ? `/session/${sessionId}/order/${o.id}/pay`
                : `/session/${sessionId}/order/${o.id}`
            }
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 transition hover:border-primary/40"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium font-mono">
                  #{o.id.slice(0, 8).toUpperCase()}
                </span>
                <OrderStatusBadge status={o.status} outstanding={o.outstanding} />
                {/* Order pay-at-cashier pending → badge + countdown. Habis →
                    refresh (server sweep membatalkan → badge hilang). */}
                {o.cashier_pending_expires_at && (
                  <PayAtCashierCountdown
                    expiresAt={o.cashier_pending_expires_at}
                    onExpire={() => router.refresh()}
                  >
                    {(mmss) => (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                        Pay at cashier
                        <span className="tabular-nums font-semibold">{mmss}</span>
                      </span>
                    )}
                  </PayAtCashierCountdown>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {o.itemCount} item{o.itemCount > 1 ? "s" : ""} ·{" "}
                {fmtTxTime(o.paidAt ?? o.createdAt)}
              </div>
              {/* Siapa yang memesan — view-only tak melihat nama (di-redaksi
                  server jadi null). */}
              {o.ordered_by && (
                <div className="text-[11px] text-muted-foreground/80 truncate">
                  by {o.ordered_by}
                </div>
              )}
            </div>
            {!hideAmount && (
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-primary tabular-nums">
                  {formatIDR(o.total)}
                </div>
                {o.outstanding > 0 && (
                  <div className="text-[10px] text-amber-400 tabular-nums">
                    {formatIDR(o.outstanding)} due
                  </div>
                )}
              </div>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Badge status order berbasis SISA tagihan (bukan cuma kolom status). Order yg
 * di-DP masih punya sisa → "Unpaid" (belum lunas), bukan "Paid". "Paid" hanya
 * kalau sisa 0. Closed = sesi ditutup.
 */
function OrderStatusBadge({ status, outstanding }: { status: string; outstanding: number }) {
  // 'cancelled' HARUS dicek lebih dulu: outstanding-nya 0, jadi tanpa cek ini
  // order batal salah tampil sebagai "Paid".
  const isCancelled = status === "cancelled";
  const isClosed = status === "closed";
  const isPaid = !isCancelled && !isClosed && outstanding <= 0;
  const label = isCancelled
    ? "Cancelled"
    : isClosed
      ? "Closed"
      : isPaid
        ? "Paid"
        : "Unpaid";
  return (
    <Badge
      variant={
        isCancelled ? "outline" : isPaid ? "success" : isClosed ? "secondary" : "warning"
      }
      className={cn("text-[10px]", isCancelled && "text-muted-foreground")}
    >
      {label}
    </Badge>
  );
}


/** Tanggal+jam ringkas order/transaksi (mis. "12 Jul, 08.30" WIB). */
function fmtTxTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}


// ============================================================
// FOOTER
// ============================================================

// ============================================================
// PENDING REQUESTS (host only — di tab Meja)
// ============================================================
function PendingRequests({
  sessionId,
  pending,
}: {
  sessionId: string;
  pending: SessionViewProps["members"];
}) {
  const confirm = useConfirm();
  const [loadingId, setLoadingId] = React.useState<string | null>(null);

  async function approve(memberId: string, name: string) {
    setLoadingId(memberId);
    try {
      await approveJoinRequest(memberId, sessionId);
      toast.success(`${name} approved`);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to approve"));
    } finally {
      setLoadingId(null);
    }
  }

  async function reject(memberId: string, name: string) {
    const ok = await confirm({
      title: `Reject ${name}'s request?`,
      description: "The request will be removed. They can request again later.",
      confirmText: "Reject",
      cancelText: "Cancel",
      variant: "destructive",
    });
    if (!ok) return;
    setLoadingId(memberId);
    try {
      await rejectJoinRequest(memberId, sessionId);
      toast.success("Request rejected");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to reject"));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Card className="p-5 border-amber-500/40 bg-amber-500/5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-400 mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4" />
        Join requests ({pending.length})
      </h2>
      <div className="space-y-3">
        {pending.map((m) => (
          <div key={m.id} className="flex items-center gap-3">
            <Avatar>
              {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
              <AvatarFallback>{initials(m.profile.display_name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{m.profile.display_name}</p>
              {m.rating && m.rating.rating_count > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-primary text-primary" />
                  {m.rating.avg_stars}{" "}
                  <span className="text-muted-foreground/60">
                    ({m.rating.rating_count})
                  </span>
                </p>
              )}
              {m.profile.hobbies && m.profile.hobbies.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.profile.hobbies.slice(0, 3).map((h) => (
                    <span
                      key={h}
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
                    >
                      {h}
                    </span>
                  ))}
                  {m.profile.hobbies.length > 3 && (
                    <span className="text-[10px] text-muted-foreground/60 px-1">
                      +{m.profile.hobbies.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingId === m.id}
                onClick={() => reject(m.id, m.profile.display_name)}
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                variant="gold"
                size="sm"
                disabled={loadingId === m.id}
                onClick={() => approve(m.id, m.profile.display_name)}
              >
                {loadingId === m.id ? "..." : <Check className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================
// UNDANGAN MENUNGGU KONFIRMASI (host only — info, tanpa aksi)
// User yg diundang (invited_by terisi) belum menerima. Host hanya melihat
// statusnya — yang menerima/menolak adalah si user lewat notifikasi.
// ============================================================
function InvitedPending({
  invited,
  sessionId,
}: {
  invited: SessionViewProps["members"];
  sessionId: string;
}) {
  const confirm = useConfirm();
  const [loadingId, setLoadingId] = React.useState<string | null>(null);

  async function cancel(memberId: string, name: string) {
    const ok = await confirm({
      title: `Cancel invite for ${name}?`,
      description:
        "The invite will be removed. You can invite them again later.",
      confirmText: "Cancel invite",
      cancelText: "No",
      variant: "destructive",
    });
    if (!ok) return;
    setLoadingId(memberId);
    try {
      await cancelInvite(memberId, sessionId);
      toast.success("Invite cancelled");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel invite"));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Card className="p-5 border-border bg-muted/20">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        Awaiting confirmation ({invited.length})
      </h2>
      <div className="space-y-3">
        {invited.map((m) => (
          <div key={m.id} className="flex items-center gap-3">
            <Avatar>
              {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
              <AvatarFallback>{initials(m.profile.display_name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">
                {m.profile.display_name}
              </p>
              <p className="text-xs text-muted-foreground">
                Invited · not answered yet
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={loadingId === m.id}
              onClick={() => cancel(m.id, m.profile.display_name)}
              className="shrink-0 text-muted-foreground hover:text-red-400"
            >
              {loadingId === m.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <X className="h-4 w-4" />
                  <span className="hidden sm:inline">Cancel</span>
                </>
              )}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Tombol "Minta gabung" untuk non-host/non-member di meja public open.
function RequestJoinButton({
  sessionId,
  hostName,
  full,
  alreadyPending,
}: {
  sessionId: string;
  hostName: string;
  full: boolean;
  alreadyPending: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState(alreadyPending);

  async function handleRequest() {
    setLoading(true);
    try {
      const res = await requestJoinSession({ sessionId });
      if (res.status === "pending") {
        setPending(true);
        toast.success(`Request sent to ${hostName}`);
      } else if (res.status === "joined") {
        toast.success("You're already a member of this table");
        router.refresh();
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to send request"));
    } finally {
      setLoading(false);
    }
  }

  if (pending) {
    return (
      <div className="flex items-center gap-3 pt-3 mt-1 border-t border-border">
        <div className="h-10 w-10 rounded-full border-2 border-dashed border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-amber-400">
            Waiting for host approval
          </p>
          <p className="text-xs text-muted-foreground">
            You&apos;ll join the table once {hostName} approves.
          </p>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleRequest}
      disabled={loading || full}
      className="w-full flex items-center gap-3 pt-3 mt-1 border-t border-border text-left group disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="h-10 w-10 rounded-full border-2 border-dashed border-primary/40 group-hover:border-primary flex items-center justify-center transition shrink-0 text-primary">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-primary">
          {full ? "Table is full" : "Request to join this table"}
        </p>
        <p className="text-xs text-muted-foreground">
          {full
            ? "Wait for an empty seat first"
            : `Send a request to ${hostName}, join once approved`}
        </p>
      </div>
    </button>
  );
}

function SessionFooter({
  total,
  paid,
  remaining,
  isHost,
  isMember,
  isStaff,
  isEnded,
  sessionId,
}: {
  /** Total tagihan SELURUH order di meja (sudah termasuk pajak & service). */
  total: number;
  /** Sudah dibayar (seluruh order). */
  paid: number;
  /** Sisa yang belum dibayar (seluruh order). */
  remaining: number;
  isHost: boolean;
  isMember: boolean;
  isStaff: boolean;
  isEnded: boolean;
  sessionId: string;
}) {
  const confirm = useConfirm();
  const [acting, setActing] = React.useState(false);
  const isLunas = total > 0 && remaining === 0;
  // Host & staff bisa tutup meja; member biasa bisa keluar. Saat sudah ditutup
  // (ended), tak ada aksi tutup/keluar — meja sudah selesai.
  const canClose = (isHost || isStaff) && !isEnded;
  const showAction = isMember && !isEnded;

  async function handleClose() {
    const ok = await confirm({
      title: "Close this table?",
      description: isStaff
        ? "Orders will be locked. Guests can no longer add orders."
        : "Once closed, orders are locked and you'll be taken to the rating page.",
      confirmText: "Close table",
      cancelText: "Not yet",
      variant: "danger",
    });
    if (!ok) return;
    setActing(true);
    try {
      await closeSession(sessionId);
      // sukses → redirect (rate/dashboard); biarkan tetap loading.
    } catch (err) {
      // Fallback berguna: di production Next.js menyensor pesan server action
      // jadi teks generik "An error occurred in the Server Components render…"
      // yang tak berarti bagi user. Penyebab paling mungkin di sini adalah
      // tagihan belum lunas (mis. pembayaran masuk tepat bersamaan), jadi
      // sampaikan itu alih-alih meneruskan teks generiknya.
      const msg = getActionErrorMessage(err, "Failed");
      toast.error(
        msg.includes("Server Components render")
          ? "Settle all payments before closing the table."
          : msg
      );
      setActing(false);
    }
  }

  async function handleLeave() {
    const ok = await confirm({
      title: "Leave this table?",
      description:
        "The bill items you've ordered stay visible to other members. You can join again via the invite link if you change your mind.",
      confirmText: "Leave",
      cancelText: "Stay at table",
      variant: "destructive",
    });
    if (!ok) return;
    setActing(true);
    try {
      await leaveSession(sessionId);
      toast.success("You left the table");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed"));
      setActing(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur-md">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {remaining > 0 ? "Unpaid" : "Paid"}
          </div>
          <div className="text-lg font-bold text-primary">
            {/* Masih ada sisa → tampilkan SISA; sudah lunas → tampilkan total
                yang dibayar. Pembagi = total tagihan meja (sudah + pajak). */}
            {formatIDR(remaining > 0 ? remaining : paid)}{" "}
            {total > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                / {formatIDR(total)}
              </span>
            )}
          </div>
        </div>
        {showAction &&
          (canClose ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              // Belum lunas → tombol dimatikan, untuk STAFF maupun HOST.
              // Server memang menolak host menutup meja yg masih punya order
              // unpaid / sisa tagihan, tapi di production build pesan error
              // server action DISENSOR Next.js jadi teks generik "An error
              // occurred in the Server Components render…" — user tak tahu apa
              // yang salah. Jadi cegah di sini, dgn alasan yang jelas.
              disabled={acting || !isLunas}
              title={
                !isLunas
                  ? isStaff
                    ? "Table not fully paid. Direct the guest to the cashier"
                    : "Settle all payments before closing the table"
                  : undefined
              }
            >
              {acting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              Close table{!isLunas ? " (not paid)" : ""}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLeave}
              // Tak boleh keluar selama meja masih punya sisa tagihan — cegah
              // orang kabur dari tanggungan bersama. (Server juga menolaknya.)
              disabled={acting || remaining > 0}
              title={
                remaining > 0
                  ? "Settle the table bill before leaving"
                  : undefined
              }
              className="text-red-400"
            >
              {acting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {remaining > 0 ? "Leave (bill unpaid)" : "Leave"}
            </Button>
          ))}
      </div>
    </div>
  );
}
