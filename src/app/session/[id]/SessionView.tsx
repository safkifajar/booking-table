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
  Wallet,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatIDR, initials, cn, getActionErrorMessage } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import { useConfirm } from "@/components/ConfirmDialog";
import { PaymentConfetti } from "@/components/PaymentConfetti";
import {
  addOrderItem,
  removeOrderItem,
  closeSession,
  leaveSession,
  payShare,
  approveJoinRequest,
  rejectJoinRequest,
  inviteUsersToSession,
} from "@/lib/actions";
import { staffAddGuestToTable } from "@/lib/waiter-actions";
import { useSessionRealtime } from "@/hooks/useSessionRealtime";
import { MenuPicker, type MenuPickerCategory } from "@/components/menu/MenuPicker";
import { SplitPayment } from "@/components/session/SplitPayment";
import { UserInvitePicker } from "@/components/session/UserInvitePicker";
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

type Tab = "vibe" | "menu" | "bill" | "pay";

interface SessionViewProps {
  session: {
    id: string;
    title: string | null;
    status: SessionStatus;
    visibility: SessionVisibility;
    vibe_tags: string[];
    started_at: string;
    host_id: string;
  };
  table: { label: string; capacity: number; shape: TableShape };
  areaName: string;
  bar: { name: string; slug: string };
  host: { id: string; display_name: string; avatar_url: string | null };
  members: Array<{
    id: string;
    role: MemberRole;
    status: MemberStatus;
    joined_at: string;
    /** Terisi = diundang host (user yg approve). NULL + pending = request-join. */
    invited_by: string | null;
    profile: { id: string; display_name: string; avatar_url: string | null; hobbies?: string[] };
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
    paid_at: string | null;
    paid_by: string;
    paid_by_avatar: string | null;
  }>;
  menu: MenuPickerCategory[];
  myProfileId: string;
  myMemberId: string | null;
  isHost: boolean;
  isMember: boolean;
  inviteCode: string | null;
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
}

export function SessionView(props: SessionViewProps) {
  const [tab, setTab] = React.useState<Tab>("vibe");
  const router = useRouter();
  useSessionRealtime(props.session.id);

  // Staff (waiter/cashier/manager/admin) yang bukan member meja tetap bisa
  // interact dengan UI cart/payment. Order item akan attributed ke member
  // tujuan (default = host) dengan input_by_staff_id audit trail.
  const isStaff = !!props.staffRole;
  const canInteract = props.isMember || isStaff;
  // Default target member untuk staff input order = host meja
  const joinedMembers = React.useMemo(
    () => props.members.filter((m) => m.status === "joined"),
    [props.members]
  );
  const hostMember = React.useMemo(
    () => joinedMembers.find((m) => m.role === "host") ?? joinedMembers[0],
    [joinedMembers]
  );
  const [staffTargetMemberId, setStaffTargetMemberId] = React.useState<
    string | null
  >(hostMember?.id ?? null);
  // Sync target kalau member list berubah (mis. host pindah)
  React.useEffect(() => {
    if (
      isStaff &&
      hostMember &&
      !joinedMembers.find((m) => m.id === staffTargetMemberId)
    ) {
      setStaffTargetMemberId(hostMember.id);
    }
  }, [isStaff, hostMember, joinedMembers, staffTargetMemberId]);

  const subtotal = props.orderItems.reduce(
    (acc, item) => acc + item.quantity * item.unit_price,
    0
  );
  const totalPaid = props.payments
    .filter((p) => p.status === "paid")
    .reduce((acc, p) => acc + p.amount, 0);
  const remaining = Math.max(0, subtotal - totalPaid);
  const isLunas = subtotal > 0 && remaining === 0;

  // Auto-redirect member ke halaman rate saat host menutup session — TAPI hanya
  // kalau sudah lunas. Kalau closed tapi masih nunggak (force-close / data lama),
  // tetap di sini supaya bisa LUNASI dulu (jangan paksa ke rating).
  React.useEffect(() => {
    if (props.session.status === "closed" && props.isMember && remaining <= 0) {
      router.replace(`/session/${props.session.id}/rate`);
    }
  }, [props.session.status, props.session.id, router, props.isMember, remaining]);

  return (
    <main className="flex-1 pb-32">
      <PaymentConfetti trigger={isLunas} />
      {/* Header */}
      <SessionHeader {...props} />

      {/* Tab strip */}
      <div className="sticky top-[57px] z-10 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-3xl mx-auto px-2">
          <div className="flex">
            <TabButton
              icon={<Users className="h-4 w-4" />}
              label="Meja"
              active={tab === "vibe"}
              onClick={() => setTab("vibe")}
              badge={props.members.filter((m) => m.status === "joined").length}
              alert={
                props.isHost &&
                // Alert kuning hanya untuk request-join (butuh aksi host).
                // Undangan menunggu (invited_by terisi) bukan tugas host.
                props.members.some(
                  (m) => m.status === "pending" && m.invited_by == null
                )
              }
            />
            <TabButton
              icon={<Utensils className="h-4 w-4" />}
              label="Menu"
              active={tab === "menu"}
              onClick={() => setTab("menu")}
            />
            <TabButton
              icon={<Receipt className="h-4 w-4" />}
              label="Bill"
              active={tab === "bill"}
              onClick={() => setTab("bill")}
              badge={props.orderItems.length || undefined}
            />
            <TabButton
              icon={<Wallet className="h-4 w-4" />}
              label="Bayar"
              active={tab === "pay"}
              onClick={() => setTab("pay")}
            />
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {tab === "vibe" && <VibeTab {...props} isStaff={isStaff} />}
        {tab === "menu" && (
          <MenuTab
            menu={props.menu}
            sessionId={props.session.id}
            canInteract={canInteract}
            isStaff={isStaff}
            joinedMembers={joinedMembers}
            staffTargetMemberId={staffTargetMemberId}
            setStaffTargetMemberId={setStaffTargetMemberId}
          />
        )}
        {tab === "bill" && (
          <BillTab
            items={props.orderItems}
            myProfileId={props.myProfileId}
            isHost={props.isHost}
            sessionId={props.session.id}
            subtotal={subtotal}
          />
        )}
        {tab === "pay" && (
          <SplitTab
            sessionId={props.session.id}
            items={props.orderItems}
            payments={props.payments}
            members={props.members.filter((m) => m.status === "joined")}
            myMemberId={props.myMemberId}
            subtotal={subtotal}
            remaining={remaining}
          />
        )}
      </div>

      {/* Sticky bottom bar */}
      <SessionFooter
        subtotal={subtotal}
        remaining={remaining}
        isHost={props.isHost}
        isMember={canInteract}
        isStaff={isStaff}
        sessionId={props.session.id}
      />
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
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant="default" className="text-[10px]">
              {props.table.label}
            </Badge>
            <VisibilityIcon visibility={props.session.visibility} />
            <span className="text-xs text-muted-foreground truncate">
              {props.areaName} · {props.bar.name}
            </span>
          </div>
          <h1 className="text-base sm:text-lg font-semibold truncate">
            {props.session.title ?? "Open Table"}
          </h1>
          {props.openedByStaff && (
            <div className="flex items-center gap-1 mt-0.5">
              <Sparkles className="h-3 w-3 text-primary/70" />
              <span className="text-[10px] text-primary/70">
                Walk-in · Dibuka oleh {props.openedByStaff.display_name}
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
function VibeTab(props: SessionViewProps & { isStaff: boolean }) {
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
  const slotsAvailable = props.table.capacity - joined.length;
  const [addGuestModal, setAddGuestModal] = React.useState(false);
  const [inviteModal, setInviteModal] = React.useState(false);
  // Tombol "Tambah Tamu" cuma muncul untuk staff di session walk-in
  // (yang dibuka oleh staff lewat opened_by_staff_id). Untuk session customer
  // reguler, tamu tambah lewat invite link.
  const canStaffAddGuest =
    props.isStaff && !!props.openedByStaff && slotsAvailable > 0;

  return (
    <div className="space-y-4">
      {/* Vibe tags */}
      {props.session.vibe_tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {props.session.vibe_tags.map((v) => (
            <Badge key={v} variant="secondary" className="text-xs">
              {v}
            </Badge>
          ))}
        </div>
      )}

      {/* Pending requests — host only */}
      {props.isHost && pending.length > 0 && (
        <PendingRequests sessionId={props.session.id} pending={pending} />
      )}

      {/* Undangan menunggu konfirmasi user — host only, TANPA tombol approve
          (yang menerima undangan adalah si user, bukan host). */}
      {props.isHost && invitedPending.length > 0 && (
        <InvitedPending invited={invitedPending} />
      )}

      {/* Members */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Di Meja ({joined.length}/{props.table.capacity})
          </h2>
          <RelativeTime date={props.session.started_at} className="text-xs text-muted-foreground" />
        </div>
        <div className="space-y-3">
          {joined.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar>
                {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
                <AvatarFallback>{initials(m.profile.display_name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-sm truncate">{m.profile.display_name}</p>
                  {m.role === "host" && (
                    <Crown className="h-3 w-3 text-primary" aria-label="Host" />
                  )}
                  {m.profile.id === props.myProfileId && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      kamu
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
                    Join <RelativeTime date={m.joined_at} />
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
          {slotsAvailable > 0 &&
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
                    Tambah Tamu
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {slotsAvailable} kursi kosong
                  </p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 opacity-50">
                <div className="h-10 w-10 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm">{slotsAvailable} kursi kosong</p>
                  <p className="text-xs text-muted-foreground">
                    Bagikan link invite
                  </p>
                </div>
              </div>
            ))}

          {/* Ajak/Undang user (host only) — 2 mode seperti open table.
              Sembunyikan kalau meja penuh; tampilkan info "penuh" sbg gantinya. */}
          {props.isHost &&
            (slotsAvailable > 0 ? (
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
                    Ajak / Undang teman
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pilih user untuk gabung langsung atau via undangan
                  </p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 pt-3 mt-1 border-t border-border text-muted-foreground">
                <div className="h-10 w-10 rounded-full border-2 border-dashed border-border flex items-center justify-center shrink-0">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Meja sudah penuh</p>
                  <p className="text-xs text-muted-foreground">
                    Semua {props.table.capacity} kursi terisi
                  </p>
                </div>
              </div>
            ))}
        </div>
      </Card>

      {inviteModal && (
        <InviteToSessionModal
          sessionId={props.session.id}
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
      toast.success(`Tamu "${clean}" ditambahkan`);
      onClose();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal tambah tamu"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
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
              <h2 className="text-sm font-semibold">Tambah Tamu ke Meja</h2>
              <p className="text-[11px] text-muted-foreground">
                {remainingSlots} kursi kosong
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Tutup"
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
              Nama tamu
            </label>
            <input
              id="guestName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cth: Bu Sari"
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
                Menambahkan...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Tambah Tamu
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

// Modal: host ajak/undang user ke meja berjalan (2 mode: friends / invite)
function InviteToSessionModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"friends" | "invite">("friends");
  const [selected, setSelected] = React.useState<InviteCandidate[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit() {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await inviteUsersToSession({
        sessionId,
        userIds: selected.map((s) => s.id),
        mode,
      });
      toast.success(
        mode === "friends"
          ? `${res.invited} teman bergabung`
          : `Undangan dikirim ke ${res.invited} user`
      );
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal mengundang"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
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
            <h2 className="text-sm font-semibold">Ajak / Undang ke Meja</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Pilih mode */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("friends")}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                mode === "friends"
                  ? "border-primary/40 bg-primary/15"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <UserPlus
                className={cn(
                  "h-4 w-4 mb-1",
                  mode === "friends" ? "text-primary" : "text-muted-foreground"
                )}
              />
              <p className="text-sm font-medium">Teman</p>
              <p className="text-[11px] text-muted-foreground">Langsung gabung</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("invite")}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                mode === "invite"
                  ? "border-primary/40 bg-primary/15"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <Lock
                className={cn(
                  "h-4 w-4 mb-1",
                  mode === "invite" ? "text-primary" : "text-muted-foreground"
                )}
              />
              <p className="text-sm font-medium">Undang</p>
              <p className="text-[11px] text-muted-foreground">Perlu diterima</p>
            </button>
          </div>

          <UserInvitePicker
            mode={mode === "friends" ? "join" : "invite"}
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
                Mengirim...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                {mode === "friends"
                  ? `Ajak ${selected.length || ""} teman`
                  : `Undang ${selected.length || ""} user`}
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
  joinedMembers,
  staffTargetMemberId,
  setStaffTargetMemberId,
}: {
  menu: MenuPickerCategory[];
  sessionId: string;
  canInteract: boolean;
  isStaff: boolean;
  joinedMembers: SessionViewProps["members"];
  staffTargetMemberId: string | null;
  setStaffTargetMemberId: (id: string) => void;
}) {
  if (!canInteract) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
        Join meja dulu untuk pesan.
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {isStaff && (
        <StaffOrderTargetPicker
          joinedMembers={joinedMembers}
          targetMemberId={staffTargetMemberId}
          onChange={setStaffTargetMemberId}
        />
      )}
      <MenuPicker
        menu={menu}
        onAdd={async (menuItemId, quantity, notes) => {
          if (isStaff && !staffTargetMemberId) {
            toast.error("Pilih tamu tujuan order dulu");
            return;
          }
          try {
            await addOrderItem({
              sessionId,
              menuItemId,
              quantity,
              notes,
              onBehalfOfMemberId: isStaff
                ? staffTargetMemberId ?? undefined
                : undefined,
            });
            toast.success("Pesanan ditambahkan");
          } catch (err) {
            toast.error(getActionErrorMessage(err, "Gagal menambah"));
          }
        }}
      />
    </div>
  );
}

/**
 * Picker untuk staff: pilih member meja yang jadi target order.
 * Default = host. Display avatar + nama.
 */
function StaffOrderTargetPicker({
  joinedMembers,
  targetMemberId,
  onChange,
}: {
  joinedMembers: SessionViewProps["members"];
  targetMemberId: string | null;
  onChange: (id: string) => void;
}) {
  if (joinedMembers.length === 0) {
    return (
      <Card className="p-3 text-center text-xs text-muted-foreground border-dashed">
        Belum ada tamu di meja. Tambah tamu dulu.
      </Card>
    );
  }
  return (
    <Card className="p-3 border-primary/30 bg-primary/5">
      <div className="text-[10px] uppercase tracking-wide text-primary mb-2">
        Pesan untuk
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {joinedMembers.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={cn(
              "shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-md border transition min-w-[64px]",
              targetMemberId === m.id
                ? "border-primary bg-primary/15"
                : "border-border bg-muted/30 hover:border-primary/50"
            )}
          >
            <Avatar className="h-7 w-7">
              {m.profile.avatar_url && (
                <AvatarImage src={m.profile.avatar_url} />
              )}
              <AvatarFallback className="text-[10px]">
                {initials(m.profile.display_name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-[10px] font-medium truncate max-w-[60px]">
              {m.profile.display_name}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// BILL TAB
function BillTab({
  items,
  myProfileId,
  isHost,
  sessionId,
  subtotal,
}: {
  items: SessionViewProps["orderItems"];
  myProfileId: string;
  isHost: boolean;
  sessionId: string;
  subtotal: number;
}) {
  if (items.length === 0) {
    return (
      <Card className="p-6 text-center border-dashed">
        <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Belum ada pesanan. Buka tab Menu untuk mulai pesan.
        </p>
      </Card>
    );
  }

  // Group by member
  const byMember = new Map<
    string,
    { name: string; avatar: string | null; items: typeof items; total: number }
  >();
  for (const item of items) {
    const k = item.added_by.profile_id;
    if (!byMember.has(k)) {
      byMember.set(k, {
        name: item.added_by.display_name,
        avatar: item.added_by.avatar_url,
        items: [],
        total: 0,
      });
    }
    const g = byMember.get(k)!;
    g.items.push(item);
    g.total += item.quantity * item.unit_price;
  }

  return (
    <div className="space-y-4">
      {Array.from(byMember.entries()).map(([profileId, g]) => (
        <Card key={profileId} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7">
                {g.avatar && <AvatarImage src={g.avatar} />}
                <AvatarFallback className="text-[10px]">{initials(g.name)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">
                {g.name}
                {profileId === myProfileId && (
                  <span className="text-muted-foreground"> · kamu</span>
                )}
              </span>
            </div>
            <span className="text-sm font-semibold text-primary">{formatIDR(g.total)}</span>
          </div>
          <div className="space-y-2">
            {g.items.map((i) => (
              <div key={i.id} className="flex items-start gap-2 text-sm slide-in-top">
                <span className="text-muted-foreground w-6 shrink-0">{i.quantity}×</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate">{i.menu_item.name}</p>
                    {i.queue_number !== null && (
                      <span className="text-[10px] font-mono text-primary/70 shrink-0">
                        #{String(i.queue_number).padStart(3, "0")}
                      </span>
                    )}
                  </div>
                  {i.notes && (
                    <p className="text-xs text-muted-foreground truncate">{i.notes}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {i.status === "sent" && "Dipesan"}
                    {i.status === "preparing" && "Sedang disiapkan"}
                    {i.status === "served" && "Diantar"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs">{formatIDR(i.quantity * i.unit_price)}</span>
                  {(profileId === myProfileId || isHost) && i.status !== "served" && (
                    <button
                      onClick={async () => {
                        try {
                          await removeOrderItem(i.id, sessionId);
                          toast.success("Item dihapus");
                        } catch (err) {
                          toast.error(getActionErrorMessage(err, "Gagal"));
                        }
                      }}
                      className="text-muted-foreground hover:text-red-400"
                      aria-label="Hapus"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {/* Subtotal */}
      <Card className="p-4 bg-muted/40">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold text-primary text-base">{formatIDR(subtotal)}</span>
        </div>
      </Card>
    </div>
  );
}

// SPLIT TAB
function SplitTab({
  sessionId,
  items,
  payments,
  members,
  myMemberId,
  subtotal,
  remaining,
}: {
  sessionId: string;
  items: SessionViewProps["orderItems"];
  payments: SessionViewProps["payments"];
  members: SessionViewProps["members"];
  myMemberId: string | null;
  subtotal: number;
  remaining: number;
}) {
  return (
    <SplitPayment
      sessionId={sessionId}
      items={items}
      payments={payments}
      members={members}
      myMemberId={myMemberId}
      subtotal={subtotal}
      remaining={remaining}
      onPay={async (input) => {
        try {
          const result = await payShare({ sessionId, ...input });

          // Gateway return redirect URL (Snap/Checkout-based) → arahkan ke sana
          if (result.redirectUrl) {
            window.location.href = result.redirectUrl;
            return;
          }

          // QRIS: show QR di dialog. Untuk mock gateway, qrString bukan EMV valid
          // — saat real gateway (Xendit/Midtrans), itu jadi valid scannable QR.
          if (result.qrString && result.status === "pending") {
            // TODO: tampilkan QR dialog dengan poll status via /api/payments/[id]/status
            toast.info("Scan QR untuk bayar (fitur QR display coming soon)");
            return;
          }

          // Mock atau cash → status langsung paid
          if (result.status === "paid") {
            toast.success("Pembayaran berhasil");
          } else {
            toast.info("Pembayaran sedang diproses");
          }
        } catch (err) {
          toast.error(getActionErrorMessage(err, "Gagal membayar"));
        }
      }}
    />
  );
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
      toast.success(`${name} berhasil di-approve`);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal approve"));
    } finally {
      setLoadingId(null);
    }
  }

  async function reject(memberId: string, name: string) {
    const ok = await confirm({
      title: `Tolak request ${name}?`,
      description: "Request akan dihapus. Orang bisa request lagi nanti.",
      confirmText: "Tolak",
      cancelText: "Batal",
      variant: "destructive",
    });
    if (!ok) return;
    setLoadingId(memberId);
    try {
      await rejectJoinRequest(memberId, sessionId);
      toast.success("Request ditolak");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal reject"));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Card className="p-5 border-amber-500/40 bg-amber-500/5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-400 mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4" />
        Request masuk ({pending.length})
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
}: {
  invited: SessionViewProps["members"];
}) {
  return (
    <Card className="p-5 border-border bg-muted/20">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        Menunggu konfirmasi ({invited.length})
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
                Diundang · belum dijawab
              </p>
            </div>
            <Badge variant="secondary" className="text-xs shrink-0">
              Diundang
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SessionFooter({
  subtotal,
  remaining,
  isHost,
  isMember,
  isStaff,
  sessionId,
}: {
  subtotal: number;
  remaining: number;
  isHost: boolean;
  isMember: boolean;
  isStaff: boolean;
  sessionId: string;
}) {
  const confirm = useConfirm();
  const isLunas = subtotal > 0 && remaining === 0;
  // Host & staff bisa tutup meja; member biasa bisa keluar.
  const canClose = isHost || isStaff;

  async function handleClose() {
    const ok = await confirm({
      title: "Tutup meja ini?",
      description: isStaff
        ? "Pesanan akan dikunci. Tamu tidak bisa tambah order lagi."
        : "Setelah ditutup, pesanan dikunci dan kalian diarahkan ke halaman rating.",
      confirmText: "Tutup meja",
      cancelText: "Belum dulu",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await closeSession(sessionId);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal"));
    }
  }

  async function handleLeave() {
    const ok = await confirm({
      title: "Keluar dari meja ini?",
      description:
        "Bagian bill yang sudah kamu pesan tetap muncul untuk anggota lain. Kamu bisa join lagi via link invite kalau berubah pikiran.",
      confirmText: "Keluar",
      cancelText: "Tetap di meja",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await leaveSession(sessionId);
      toast.success("Kamu meninggalkan meja");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal"));
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur-md">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {remaining > 0 ? "Belum terbayar" : "Lunas"}
          </div>
          <div className="text-lg font-bold text-primary">
            {formatIDR(remaining)}{" "}
            {subtotal > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                / {formatIDR(subtotal)}
              </span>
            )}
          </div>
        </div>
        {isMember &&
          (canClose ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              // Staff: hanya boleh tutup kalau lunas (sama spt guard sebelumnya).
              disabled={isStaff && !isLunas}
              title={
                isStaff && !isLunas
                  ? "Meja belum lunas — arahkan tamu ke kasir"
                  : undefined
              }
            >
              <Lock className="h-4 w-4" />
              Tutup meja{isStaff && !isLunas ? " (belum lunas)" : ""}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLeave}
              className="text-red-400"
            >
              <LogOut className="h-4 w-4" />
              Keluar
            </Button>
          ))}
      </div>
    </div>
  );
}
