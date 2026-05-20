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
  Share2,
  Copy,
  Check,
  Lock,
  Globe,
  UserPlus,
  Crown,
  X,
  LogOut,
  Star,
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
} from "@/lib/actions";
import { useSessionRealtime } from "@/hooks/useSessionRealtime";
import { MenuPicker, type MenuPickerCategory } from "@/components/menu/MenuPicker";
import { SplitPayment } from "@/components/session/SplitPayment";
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
    profile: { id: string; display_name: string; avatar_url: string | null };
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
  userMenu?: React.ReactNode;
}

export function SessionView(props: SessionViewProps) {
  const [tab, setTab] = React.useState<Tab>("vibe");
  const router = useRouter();
  useSessionRealtime(props.session.id);

  // Auto-redirect member ke halaman rate saat host menutup session.
  // Host sendiri sudah di-redirect via Server Action closeSession().
  React.useEffect(() => {
    if (props.session.status === "closed") {
      router.replace(`/session/${props.session.id}/rate`);
    }
  }, [props.session.status, props.session.id, router]);

  const subtotal = props.orderItems.reduce(
    (acc, item) => acc + item.quantity * item.unit_price,
    0
  );
  const totalPaid = props.payments
    .filter((p) => p.status === "paid")
    .reduce((acc, p) => acc + p.amount, 0);
  const remaining = Math.max(0, subtotal - totalPaid);
  const isLunas = subtotal > 0 && remaining === 0;

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
                props.members.some((m) => m.status === "pending")
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
        {tab === "vibe" && <VibeTab {...props} />}
        {tab === "menu" && (
          <MenuTab
            menu={props.menu}
            sessionId={props.session.id}
            isMember={props.isMember}
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
        isMember={props.isMember}
        sessionId={props.session.id}
      />
    </main>
  );
}

// ============================================================
// HEADER
// ============================================================

function SessionHeader(props: SessionViewProps) {
  const [copied, setCopied] = React.useState(false);
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (props.inviteCode) {
      setInviteUrl(`${window.location.origin}/join/${props.inviteCode}`);
    }
  }, [props.inviteCode]);

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success("Link disalin");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Gagal salin");
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/bar/${props.bar.slug}`} aria-label="Back">
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
        </div>
        {props.isMember && inviteUrl && (
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Invite"}</span>
          </Button>
        )}
        {props.userMenu}
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
function VibeTab(props: SessionViewProps) {
  const joined = props.members.filter((m) => m.status === "joined");
  const pending = props.members.filter((m) => m.status === "pending");

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
              </div>
            </div>
          ))}
          {joined.length < props.table.capacity && (
            <div className="flex items-center gap-3 opacity-50">
              <div className="h-10 w-10 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm">
                  {props.table.capacity - joined.length} kursi kosong
                </p>
                <p className="text-xs text-muted-foreground">Bagikan link invite</p>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// MENU TAB
function MenuTab({
  menu,
  sessionId,
  isMember,
}: {
  menu: MenuPickerCategory[];
  sessionId: string;
  isMember: boolean;
}) {
  if (!isMember) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
        Join meja dulu untuk pesan.
      </Card>
    );
  }
  return (
    <MenuPicker
      menu={menu}
      onAdd={async (menuItemId, quantity, notes) => {
        try {
          await addOrderItem({ sessionId, menuItemId, quantity, notes });
          toast.success("Pesanan ditambahkan");
        } catch (err) {
          toast.error(getActionErrorMessage(err, "Gagal menambah"));
        }
      }}
    />
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
          await payShare({ sessionId, ...input });
          toast.success("Pembayaran tercatat");
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

function SessionFooter({
  subtotal,
  remaining,
  isHost,
  isMember,
  sessionId,
}: {
  subtotal: number;
  remaining: number;
  isHost: boolean;
  isMember: boolean;
  sessionId: string;
}) {
  const [showActions, setShowActions] = React.useState(false);
  const confirm = useConfirm();

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
        <div className="flex items-center gap-2 relative">
          {isMember && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowActions((v) => !v)}
              aria-label="More actions"
            >
              Menu Aksi
            </Button>
          )}
          {showActions && (
            <div className="absolute bottom-full right-0 mb-2 w-56 rounded-md border border-border bg-card shadow-xl overflow-hidden">
              {isHost ? (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  onClick={async () => {
                    setShowActions(false);
                    const ok = await confirm({
                      title: "Tutup meja & selesaikan bill?",
                      description:
                        "Setelah ditutup, pesanan dikunci dan kalian diarahkan ke halaman rating untuk anggota lain.",
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
                  }}
                >
                  <Lock className="h-4 w-4" />
                  Tutup meja (host)
                </button>
              ) : (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 text-red-400"
                  onClick={async () => {
                    setShowActions(false);
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
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Keluar dari meja
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
