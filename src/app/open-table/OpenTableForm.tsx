"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Lock,
  Globe,
  UserPlus,
  UtensilsCrossed,
  Plus,
  Minus,
  X,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { openTable } from "@/lib/actions";
import { useConfirm } from "@/components/ConfirmDialog";
import { type InviteCandidate } from "@/lib/customer-actions";
import { UserInvitePicker } from "@/components/session/UserInvitePicker";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import { AvatarViewer } from "@/components/network/AvatarViewer";
import { formatIDR, getActionErrorMessage, cn } from "@/lib/utils";
import type { TableShape, SessionVisibility } from "@/types/db";
import type { ReservationConfig } from "@/lib/settings-constants";
import type { AvailableSlot } from "@/lib/reservation-format";

interface MenuItemLite {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
}
interface MenuCategoryLite {
  id: string;
  name: string;
  items: MenuItemLite[];
}

interface Props {
  table: {
    id: string;
    label: string;
    shape: TableShape;
    capacity: number;
    min_spend: number;
  };
  areaName: string;
  barName: string;
  barSlug: string;
  reservationConfig: ReservationConfig;
  slots: AvailableSlot[];
  /** ISO slot yang sudah ke-booking reservasi lain (di-disable di picker). */
  bookedSlotIsos?: string[];
  /** Prefill jam mulai/selesai (ISO) — dari deep-link bottom sheet denah. */
  initialStart?: string;
  initialEnd?: string;
  menu: MenuCategoryLite[];
}

const VIBE_OPTIONS = [
  "chill",
  "networking",
  "celebrate",
  "date",
  "after-work",
  "loud",
];

type WaktuMode = "now" | "reservation";

export function OpenTableForm({
  table,
  areaName,
  barSlug,
  reservationConfig,
  slots,
  bookedSlotIsos = [],
  initialStart,
  initialEnd,
  menu,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  // True saat kita SUDAH konfirmasi & benar-benar mau keluar (biar handler
  // popstate tak minta konfirmasi 2x).
  const leavingRef = React.useRef(false);

  // Konfirmasi batal open table, lalu balik ke denah kalau user setuju.
  const confirmLeave = React.useCallback(async () => {
    const ok = await confirm({
      title: "Cancel opening this table?",
      description:
        "Your table setup won't be saved and the table stays available. You can start again anytime.",
      confirmText: "Discard",
      cancelText: "Keep editing",
      variant: "danger",
    });
    if (ok) {
      leavingRef.current = true;
      router.push(`/bar/${barSlug}`);
    }
    return ok;
  }, [confirm, router, barSlug]);

  // Intercept tombol BACK HP/browser: dorong 1 entry history saat mount, lalu
  // saat popstate (back ditekan) → tahan & minta konfirmasi. Kalau user pilih
  // keluar, confirmLeave sudah router.push; kalau batal, dorong lagi entry biar
  // back berikutnya tetap ke-intercept.
  React.useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPop = () => {
      if (leavingRef.current) return; // sudah dikonfirmasi keluar
      // Balikin entry yg baru saja di-pop supaya tetap di halaman ini.
      window.history.pushState(null, "", window.location.href);
      void confirmLeave();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [confirmLeave]);

  const [visibility, setVisibility] =
    React.useState<SessionVisibility>("public");
  const [vibes, setVibes] = React.useState<string[]>([]);
  // User yg diajak/diundang (friends/invite_only).
  const [invited, setInvited] = React.useState<InviteCandidate[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Form ini khusus reservasi customer — selalu mode reservation (pilih slot + DP).
  // Walk-in immediate ada di flow staff/waiter terpisah.
  const waktuMode: WaktuMode = "reservation";
  // Prefill dari deep-link (bottom sheet denah). Tanggal di-derive LANGSUNG
  // dari initialStart (bukan cari di slots) supaya jam yg dipilih di jadwal
  // tetap tampil terpilih walau slot itu tak persis ada di list generate.
  const [selectedSlot, setSelectedSlot] = React.useState<string>(
    () => initialStart ?? ""
  );
  const [selectedEnd, setSelectedEnd] = React.useState<string>(
    () => (initialStart && initialEnd ? initialEnd : "")
  );

  // Cart order awal: Map<menuItemId, quantity>
  const [cart, setCart] = React.useState<Map<string, number>>(new Map());
  const [menuModalOpen, setMenuModalOpen] = React.useState(false);

  const reservationEnabled = reservationConfig.enabled && slots.length > 0;
  const hasMinSpend = table.min_spend > 0;

  const slotMs = reservationConfig.slotIntervalMinutes * 60 * 1000;

  // Selesai efektif: kalau user baru klik 1 jam (end kosong), anggap 1 slot.
  // Dipakai utk submit reservationEndAt.
  const effectiveEnd = React.useMemo(() => {
    if (selectedEnd) return selectedEnd;
    if (selectedSlot)
      return new Date(new Date(selectedSlot).getTime() + slotMs).toISOString();
    return "";
  }, [selectedSlot, selectedEnd, slotMs]);

  // Flat menu item lookup
  const itemLookup = React.useMemo(() => {
    const map = new Map<string, MenuItemLite>();
    for (const cat of menu) {
      for (const it of cat.items) map.set(it.id, it);
    }
    return map;
  }, [menu]);

  const cartTotal = React.useMemo(() => {
    let sum = 0;
    for (const [id, qty] of cart) {
      const item = itemLookup.get(id);
      if (item) sum += item.price * qty;
    }
    return sum;
  }, [cart, itemLookup]);

  const cartItemCount = React.useMemo(() => {
    let n = 0;
    for (const qty of cart.values()) n += qty;
    return n;
  }, [cart]);

  // DP calc — hanya untuk reservasi
  const dpRequired =
    waktuMode === "reservation" &&
    reservationConfig.minDownPaymentPercent > 0 &&
    cartTotal > 0;
  const dpAmount = dpRequired
    ? Math.ceil(
        (cartTotal * reservationConfig.minDownPaymentPercent) / 100 / 100
      ) * 100
    : 0;

  // Validasi: min spend
  const minSpendShortfall = hasMinSpend
    ? Math.max(0, table.min_spend - cartTotal)
    : 0;

  // Order awal wajib kalau: min spend ada, ATAU reservasi + DP
  const orderRequired =
    hasMinSpend ||
    (waktuMode === "reservation" &&
      reservationConfig.minDownPaymentPercent > 0);

  function toggleVibe(v: string) {
    setVibes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v].slice(0, 5)
    );
  }

  // Apakah rentang terpilih menabrak slot booked? (validasi submit)
  const hasConflict = React.useMemo(() => {
    if (!selectedSlot || !effectiveEnd) return false;
    const booked = new Set(bookedSlotIsos);
    const startMs = new Date(selectedSlot).getTime();
    const endMs = new Date(effectiveEnd).getTime();
    for (let t = startMs; t < endMs; t += slotMs) {
      if (booked.has(new Date(t).toISOString())) return true;
    }
    return false;
  }, [selectedSlot, effectiveEnd, slotMs, bookedSlotIsos]);

  // Validasi submit
  const canSubmit = React.useMemo(() => {
    if (loading) return false;
    if (!selectedSlot) return false; // minimal 1 jam dipilih
    if (hasConflict) return false; // rentang nabrak slot booked
    if (orderRequired && cartItemCount === 0) return false;
    if (hasMinSpend && cartTotal < table.min_spend) return false;
    return true;
  }, [
    loading,
    selectedSlot,
    hasConflict,
    orderRequired,
    cartItemCount,
    hasMinSpend,
    cartTotal,
    table.min_spend,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      const initialOrder = Array.from(cart.entries())
        .filter(([, qty]) => qty > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));

      const result = await openTable({
        tableId: table.id,
        visibility,
        vibeTags: vibes,
        reservationAt: selectedSlot || null,
        reservationEndAt: effectiveEnd || null,
        initialOrder: initialOrder.length > 0 ? initialOrder : undefined,
        dpMethod: dpRequired ? "mock" : undefined,
        // Public & friends → teman langsung join; invite_only → diundang.
        // Semua visibility boleh bawa teman spesifik.
        invitedUserIds:
          invited.length > 0 ? invited.map((u) => u.id) : undefined,
      });
      // Sukses → openTable redirect (tak return apa-apa). Kalau ada return
      // { ok:false }, itu validasi reservasi (jam operasi/slot lewat/bentrok)
      // yang alasannya harus ditampilkan ke user.
      if (result && result.ok === false) {
        toast.error(result.error);
        if (result.error.toLowerCase().includes("booked")) {
          router.push(`/bar/${barSlug}`);
          return;
        }
        setLoading(false);
        return;
      }
      // openTable redirects on success
    } catch (err) {
      const message = getActionErrorMessage(err, "Failed to open table");
      toast.error(message);
      // Slot keburu dibooking orang lain (race) → balik ke denah biar user
      // bisa pilih meja/jam lain dgn data terbaru.
      if (message.toLowerCase().includes("booked")) {
        router.push(`/bar/${barSlug}`);
        return;
      }
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void confirmLeave()}
            className="text-muted-foreground hover:text-foreground transition"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-medium">
            Open Table
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Table {table.label}</CardTitle>
            <CardDescription className="mt-1">
              {areaName} · {table.shape} · capacity {table.capacity}
              {table.min_spend > 0 && ` · min ${formatIDR(table.min_spend)}`}
            </CardDescription>
          </div>
          <Badge variant="default">{table.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Pilih waktu reservasi: tanggal → jam mulai → jam selesai */}
          {reservationEnabled ? (
            <SlotRangePicker
              slots={slots}
              bookedSlotIsos={bookedSlotIsos}
              slotIntervalMinutes={reservationConfig.slotIntervalMinutes}
              bookingWindowDays={reservationConfig.bookingWindowDays}
              startIso={selectedSlot}
              endIso={selectedEnd}
              onChange={(start, end) => {
                setSelectedSlot(start);
                setSelectedEnd(end);
              }}
              initialStart={initialStart}
            />
          ) : (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              Reservations are not available right now. Try again later or contact the bar.
            </div>
          )}

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Who can join?
            </label>
            <div className="grid grid-cols-3 gap-2">
              <VisibilityOption
                icon={<Globe className="h-4 w-4" />}
                label="Public"
                desc="Anyone"
                active={visibility === "public"}
                onClick={() => setVisibility("public")}
              />
              <VisibilityOption
                icon={<UserPlus className="h-4 w-4" />}
                label="Friends"
                desc="Friends only"
                active={visibility === "friends"}
                onClick={() => setVisibility("friends")}
              />
              <VisibilityOption
                icon={<Lock className="h-4 w-4" />}
                label="Invite"
                desc="Invite users"
                active={visibility === "invite_only"}
                onClick={() => setVisibility("invite_only")}
              />
            </div>
          </div>

          {/* Pilih teman untuk diajak. public/friends → langsung join;
              invite_only → diundang (harus terima). Tampil di semua tipe. */}
          <UserInvitePicker
            mode={visibility === "invite_only" ? "invite" : "join"}
            selected={invited}
            onChange={setInvited}
          />

          {/* Vibes */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Vibe{" "}
              <span className="text-muted-foreground font-normal">(max 5)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {VIBE_OPTIONS.map((v) => {
                const active = vibes.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleVibe(v)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition",
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Order awal */}
          {menu.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Initial order{" "}
                {orderRequired ? (
                  <span className="text-primary font-normal text-xs">
                    (required
                    {hasMinSpend && ` · min ${formatIDR(table.min_spend)}`})
                  </span>
                ) : (
                  <span className="text-muted-foreground font-normal text-xs">
                    (optional)
                  </span>
                )}
              </label>

              {cartItemCount === 0 ? (
                <button
                  type="button"
                  onClick={() => setMenuModalOpen(true)}
                  className="w-full flex items-center justify-between gap-2 p-3 rounded-md border border-dashed border-border hover:border-primary/50 transition text-sm text-muted-foreground"
                >
                  <span className="flex items-center gap-2">
                    <UtensilsCrossed className="h-4 w-4" />
                    Pick menu items for the initial order
                  </span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  {/* Cart summary list */}
                  <div className="divide-y divide-border">
                    {Array.from(cart.entries())
                      .filter(([, qty]) => qty > 0)
                      .map(([id, qty]) => {
                        const item = itemLookup.get(id);
                        if (!item) return null;
                        return (
                          <div
                            key={id}
                            className="flex items-center justify-between gap-2 p-2.5 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-primary font-medium mr-1">
                                {qty}×
                              </span>
                              <span className="truncate">{item.name}</span>
                            </div>
                            <span className="tabular-nums text-muted-foreground shrink-0">
                              {formatIDR(item.price * qty)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMenuModalOpen(true)}
                    className="w-full p-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition border-t border-border flex items-center justify-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Edit / add order
                  </button>
                </div>
              )}

              {/* Min spend warning */}
              {hasMinSpend && cartTotal > 0 && minSpendShortfall > 0 && (
                <p className="text-xs text-amber-400 mt-1.5">
                  {formatIDR(minSpendShortfall)} short of the minimum spend.
                </p>
              )}
            </div>
          )}

          {/* Summary total + DP */}
          {cartItemCount > 0 && (
            <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Order total</span>
                <span className="font-semibold tabular-nums">
                  {formatIDR(cartTotal)}
                </span>
              </div>
              {dpRequired && (
                <div className="flex items-center justify-between text-primary">
                  <span>DP ({reservationConfig.minDownPaymentPercent}%)</span>
                  <span className="font-semibold tabular-nums">
                    {formatIDR(dpAmount)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={!canSubmit}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : dpRequired ? (
              `Pay deposit ${formatIDR(dpAmount)} & Reserve`
            ) : (
              "Create Reservation"
            )}
          </Button>

          {!canSubmit && !loading && (
            <p className="text-xs text-center text-muted-foreground -mt-2">
              {!selectedSlot
                ? "Pick a time first"
                : orderRequired && cartItemCount === 0
                  ? "Initial order is required"
                  : hasMinSpend && cartTotal < table.min_spend
                    ? `Minimum spend ${formatIDR(table.min_spend)} not reached`
                    : ""}
            </p>
          )}
        </form>
      </CardContent>

      {menuModalOpen && (
        <MenuPickerModal
          menu={menu}
          cart={cart}
          onChange={setCart}
          onClose={() => setMenuModalOpen(false)}
        />
      )}
    </Card>
  );
}

// ============================================================
// MENU PICKER MODAL (cart lokal, belum ada session)
// ============================================================

function MenuPickerModal({
  menu,
  cart,
  onChange,
  onClose,
}: {
  menu: MenuCategoryLite[];
  cart: Map<string, number>;
  onChange: (next: Map<string, number>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = React.useState<Map<string, number>>(
    () => new Map(cart)
  );
  const [activeCat, setActiveCat] = React.useState(menu[0]?.id ?? "");
  // Foto menu yg sedang diperbesar (lightbox).
  const [photo, setPhoto] = React.useState<{ src: string; alt: string } | null>(
    null
  );

  function setQty(id: string, qty: number) {
    setLocal((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }

  const total = React.useMemo(() => {
    let sum = 0;
    for (const cat of menu) {
      for (const it of cat.items) {
        const qty = local.get(it.id) ?? 0;
        sum += it.price * qty;
      }
    }
    return sum;
  }, [local, menu]);

  const itemCount = React.useMemo(() => {
    let n = 0;
    for (const qty of local.values()) n += qty;
    return n;
  }, [local]);

  function handleConfirm() {
    onChange(new Map(local));
    onClose();
  }

  const activeCategory = menu.find((c) => c.id === activeCat) ?? menu[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full h-full sm:h-auto sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl sm:max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">Select Initial Order</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Category tabs */}
        {menu.length > 1 && (
          <div className="flex gap-1.5 p-3 overflow-x-auto border-b border-border shrink-0">
            {menu.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCat(cat.id)}
                className={cn(
                  "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition",
                  activeCat === cat.id
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* Items list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {activeCategory?.items.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">
              No menu items in this category yet.
            </p>
          ) : (
            activeCategory?.items.map((item) => {
              const qty = local.get(item.id) ?? 0;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2.5 rounded-md border border-border"
                >
                  {/* Thumbnail — klik utk perbesar */}
                  {item.image_url ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPhoto({ src: item.image_url!, alt: item.name })
                      }
                      className="h-12 w-12 shrink-0 rounded-md overflow-hidden border border-border"
                      aria-label={`Enlarge photo of ${item.name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded-md border border-border bg-muted/40 flex items-center justify-center">
                      <UtensilsCrossed className="h-4 w-4 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {item.name}
                    </div>
                    {item.description && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {item.description}
                      </div>
                    )}
                    <div className="text-xs text-primary font-semibold mt-0.5">
                      {formatIDR(item.price)}
                    </div>
                  </div>
                  {qty === 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQty(item.id, 1)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setQty(item.id, qty - 1)}
                        className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-5 text-center text-sm font-medium tabular-nums">
                        {qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQty(item.id, qty + 1)}
                        className="h-7 w-7 rounded-md border border-primary/40 bg-primary/15 text-primary flex items-center justify-center hover:bg-primary/25"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border shrink-0">
          <Button
            type="button"
            variant="gold"
            size="lg"
            className="w-full"
            onClick={handleConfirm}
            disabled={itemCount === 0}
          >
            {itemCount === 0
              ? "Pick at least 1 item"
              : `Confirm · ${itemCount} items · ${formatIDR(total)}`}
          </Button>
        </div>
      </div>

      {/* Lightbox foto menu — stopPropagation supaya klik tutup lightbox tak
          ikut menutup modal Pilih Order Awal. */}
      {photo && (
        <div onClick={(e) => e.stopPropagation()}>
          <AvatarViewer
            src={photo.src}
            alt={photo.alt}
            onClose={() => setPhoto(null)}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// USER INVITE PICKER — cari & pilih user untuk diajak/diundang
// ============================================================

// ============================================================
// SHARED
// ============================================================

function VisibilityOption({
  icon,
  label,
  desc,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 p-3 rounded-md border transition text-center",
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] opacity-70">{desc}</span>
    </button>
  );
}
