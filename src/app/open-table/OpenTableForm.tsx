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
  Search,
  SlidersHorizontal,
  Check,
  ShoppingCart,
  ChevronUp,
  ChevronDown,
  Trash2,
  QrCode,
  Banknote,
} from "lucide-react";
import { openTable } from "@/lib/actions";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { type InviteCandidate } from "@/lib/customer-actions";
import { UserInvitePicker } from "@/components/session/UserInvitePicker";
import { previewMyVoucher } from "@/lib/membership-actions";
import { VoucherPicker } from "@/components/session/VoucherPicker";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import { AvatarViewer } from "@/components/network/AvatarViewer";
import { formatIDR, getActionErrorMessage, cn } from "@/lib/utils";
import type { TableShape, SessionVisibility } from "@/types/db";
import {
  calculateDP,
  computeBillTotals,
  type ChargeConfig,
  type ReservationConfig,
} from "@/lib/settings-constants";
import type { AvailableSlot } from "@/lib/reservation-format";

interface MenuItemLite {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  tags: string[];
}
interface MenuCategoryLite {
  id: string;
  name: string;
  /** Nama kategori induk (mis. "Main Course"); entri ini adalah SUB-kategori (mis. "Rice"). */
  parent_name: string | null;
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
  /** Tax & service — ikut dibayar di awal (basis DP). */
  chargeConfig: ChargeConfig;
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
  chargeConfig,
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
  // Deskripsi opsional sesi (disimpan sbg session.title, max 80).
  const [description, setDescription] = React.useState("");
  // User yg diundang (semua visibility). SEMUA undangan perlu persetujuan yg
  // diundang — tak ada auto-join.
  const [invited, setInvited] = React.useState<InviteCandidate[]>([]);
  // Voucher benefit membership utk potongan DP (PRD Membership rev-3).
  const [voucherChecking, setVoucherChecking] = React.useState(false);
  const [voucher, setVoucher] = React.useState<{
    code: string;
    name: string;
    discount: number;
  } | null>(null);
  // Metode DP: QRIS (bayar sekarang, batas 1 menit) atau Pay at cashier
  // (konfirmasi ke kasir, batas 10 menit — lewat itu booking batal).
  const [dpMethod, setDpMethod] = React.useState<"qris" | "cash">("qris");
  const [loading, setLoading] = React.useState(false);

  // Ganti visibility mengubah siapa yg SAH diundang (meja "friends" hanya
  // teman) → kosongkan pilihan supaya tak ada non-teman yg ikut terkirim lalu
  // dibuang senyap oleh server.
  function changeVisibility(next: SessionVisibility) {
    setVisibility((prev) => {
      if (prev !== next) setInvited([]);
      return next;
    });
  }

  // Dialog QRIS untuk DP booking (kalau DP wajib & pending pembayaran).
  const [dpQris, setDpQris] = React.useState<{
    paymentId: string;
    qrString: string;
    amount: number;
    sessionId: string;
  } | null>(null);

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

  // Tagihan: subtotal item + tax & service. DP dihitung dari GRAND TOTAL ini
  // (bukan subtotal mentah) — supaya DP 100% benar-benar melunasi tagihan.
  // Pakai calculateDP & computeBillTotals yang SAMA dengan server (dulu rumus
  // DP diduplikasi di sini dan basisnya beda → angka tombol ≠ angka QRIS).
  const bill = React.useMemo(
    () => computeBillTotals(cartTotal, chargeConfig),
    [cartTotal, chargeConfig]
  );
  const dpPercent = reservationConfig.minDownPaymentPercent;
  const dpRequired =
    waktuMode === "reservation" && dpPercent > 0 && cartTotal > 0;
  const dpAmount = dpRequired ? calculateDP(bill.total, dpPercent) : 0;
  // DP 100% = bayar lunas di muka → tak perlu pamer baris "DP (100%)", dan
  // tombolnya bukan "Pay deposit" melainkan "Pay to reserve".
  const dpIsFull = dpRequired && dpPercent >= 100;

  // Validasi: min spend
  const minSpendShortfall = hasMinSpend
    ? Math.max(0, table.min_spend - cartTotal)
    : 0;

  // Order awal wajib kalau: min spend ada, ATAU reservasi + DP
  const orderRequired =
    hasMinSpend ||
    (waktuMode === "reservation" &&
      reservationConfig.minDownPaymentPercent > 0);

  async function applyVoucher(codeRaw: string) {
    const code = codeRaw.trim().toUpperCase();
    if (!code || dpAmount <= 0) return;
    setVoucherChecking(true);
    try {
      const res = await previewMyVoucher({ code, amount: dpAmount });
      if (!res.ok) {
        setVoucher(null);
        toast.error(res.error);
        return;
      }
      if (res.discount >= dpAmount) {
        setVoucher(null);
        toast.error(
          "This voucher covers more than the deposit — save it for the bill payment instead."
        );
        return;
      }
      setVoucher({ code: res.code, name: res.name, discount: res.discount });
      toast.success(`${res.name} applied`);
    } catch {
      toast.error("Failed to check voucher");
    } finally {
      setVoucherChecking(false);
    }
  }

  // Nominal DP yang benar-benar dibayar setelah potongan voucher.
  const dpPayable = Math.max(0, dpAmount - (voucher?.discount ?? 0));

  // Keranjang berubah → dpAmount berubah → diskon preview basi. Reset supaya
  // user meng-apply ulang terhadap nominal baru (server toh menghitung ulang).
  React.useEffect(() => {
    setVoucher(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpAmount]);

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
        title: description.trim() || undefined,
        reservationAt: selectedSlot || null,
        reservationEndAt: effectiveEnd || null,
        initialOrder: initialOrder.length > 0 ? initialOrder : undefined,
        dpMethod: dpRequired ? dpMethod : undefined,
        voucherCode: dpRequired && voucher ? voucher.code : undefined,
        // Semua visibility boleh mengundang; yg diundang wajib menyetujui.
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
      // DP "Pay at cashier" → ke halaman tunggu konfirmasi (countdown 10 menit).
      if (result && result.ok === true && "awaitCashier" in result && result.awaitCashier) {
        router.push(`/booking/${result.sessionId}/pay`);
        return;
      }
      // DP QRIS menunggu bayar → tampilkan QR dialog, jangan redirect.
      // Setelah lunas (polling), baru masuk ke session.
      if (result && result.ok === true && "dpQris" in result && result.dpQris) {
        setDpQris({
          paymentId: result.dpQris.paymentId,
          qrString: result.dpQris.qrString,
          amount: dpAmount,
          sessionId: result.sessionId,
        });
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
                onClick={() => changeVisibility("public")}
              />
              <VisibilityOption
                icon={<UserPlus className="h-4 w-4" />}
                label="Friends"
                desc="Friends only"
                active={visibility === "friends"}
                onClick={() => changeVisibility("friends")}
              />
              <VisibilityOption
                icon={<Lock className="h-4 w-4" />}
                label="Invite"
                desc="Invite users"
                active={visibility === "invite_only"}
                onClick={() => changeVisibility("invite_only")}
              />
            </div>
          </div>

          {/* Undang orang — semua visibility, SEMUA perlu persetujuan yg
              diundang. Meja "friends" hanya boleh mengundang teman. */}
          <UserInvitePicker
            visibility={visibility}
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

          {/* Deskripsi opsional */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 80))}
              placeholder="Add a short note about this table (e.g. birthday, casual meetup)…"
              rows={2}
              maxLength={80}
              className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary/60 transition resize-none"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {description.length}/80
            </p>
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
                            className="flex items-center gap-2.5 p-2.5 text-sm"
                          >
                            {/* Thumbnail foto menu (fallback ikon). */}
                            <div className="h-9 w-9 shrink-0 rounded-md overflow-hidden bg-muted/40 flex items-center justify-center">
                              {item.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.image_url}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <UtensilsCrossed className="h-4 w-4 text-muted-foreground/40" />
                              )}
                            </div>
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

          {/* Ringkasan tagihan. Tax & service ikut dibayar di awal, jadi
              ditampilkan di sini (dulu tak muncul & DP dihitung dari subtotal).
              DP 100% = bayar lunas → baris "DP" redundan, sembunyikan. */}
          {cartItemCount > 0 && (
            <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Order total</span>
                <span className="font-semibold tabular-nums">
                  {formatIDR(bill.subtotal)}
                </span>
              </div>
              {bill.charge > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {bill.chargeLabel} ({bill.chargePercent}%)
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatIDR(bill.charge)}
                  </span>
                </div>
              )}
              {bill.charge > 0 && (
                <div className="flex items-center justify-between border-t border-border pt-1.5">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold tabular-nums">
                    {formatIDR(bill.total)}
                  </span>
                </div>
              )}
              {dpRequired && !dpIsFull && (
                <div className="flex items-center justify-between text-primary border-t border-border pt-1.5">
                  <span>Deposit ({dpPercent}%)</span>
                  <span className="font-semibold tabular-nums">
                    {formatIDR(dpAmount)}
                  </span>
                </div>
              )}
              {dpRequired && voucher && (
                <div className="flex items-center justify-between text-emerald-400">
                  <span className="truncate">
                    Voucher {voucher.name}
                  </span>
                  <span className="font-semibold tabular-nums">
                    - {formatIDR(voucher.discount)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Voucher membership utk DP (PRD Membership rev-3) — hanya saat
              reservasi ber-DP. Bill tanpa DP: voucher dipakai saat bayar. */}
          {dpRequired && dpAmount > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Membership voucher{" "}
                <span className="text-muted-foreground font-normal">
                  (optional — discount on your deposit)
                </span>
              </label>
              <VoucherPicker
                amount={dpAmount}
                applied={
                  voucher
                    ? {
                        code: voucher.code,
                        name: voucher.name,
                        discount: voucher.discount,
                      }
                    : null
                }
                checking={voucherChecking}
                onPick={applyVoucher}
                onClear={() => setVoucher(null)}
              />
            </div>
          )}

          {/* Metode pembayaran DP: QRIS sekarang vs konfirmasi di kasir */}
          {dpRequired && dpAmount > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Deposit payment method
              </label>
              {/* Daftar pilihan langsung tampil (radio) — hanya satu yang aktif. */}
              <div
                role="radiogroup"
                aria-label="Deposit payment method"
                className="space-y-2"
              >
                {(
                  [
                    { value: "qris", label: "QRIS", icon: <QrCode className="h-5 w-5" /> },
                    { value: "cash", label: "Pay at cashier", icon: <Banknote className="h-5 w-5" /> },
                  ] as const
                ).map((opt) => {
                  const active = dpMethod === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDpMethod(opt.value)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40"
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                      >
                        {opt.icon}
                      </span>
                      <span
                        className={cn(
                          "flex-1 text-sm font-medium",
                          active ? "text-primary" : "text-foreground"
                        )}
                      >
                        {opt.label}
                      </span>
                      {/* Indikator radio bulat, terisi saat aktif. */}
                      <span
                        className={cn(
                          "h-5 w-5 shrink-0 rounded-full border flex items-center justify-center transition",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border"
                        )}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {dpMethod === "cash" && (
                <p className="mt-1.5 text-xs text-amber-400">
                  Confirm &amp; pay at the cashier desk within 10 minutes —
                  otherwise the booking is cancelled and the slot reopens.
                </p>
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
            ) : dpRequired && dpMethod === "cash" ? (
              `Reserve & pay ${formatIDR(dpPayable)} at cashier`
            ) : dpIsFull ? (
              `Pay ${formatIDR(dpPayable)} to reserve`
            ) : dpRequired ? (
              `Pay deposit ${formatIDR(dpPayable)} & Reserve`
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

      {/* Dialog QRIS untuk DP booking — bayar DP dulu baru masuk sesi. */}
      {dpQris && (
        <QrisPaymentDialog
          paymentId={dpQris.paymentId}
          qrString={dpQris.qrString}
          amount={dpQris.amount}
          expirySeconds={60}
          onPaid={() => {
            // DP lunas → booking terkonfirmasi, masuk ke sesi.
            const sid = dpQris.sessionId;
            setDpQris(null);
            router.push(`/session/${sid}`);
          }}
          onExpired={() => {
            // Waktu habis → booking dibatalkan (dialog sudah panggil
            // cancelPayment). Balik ke denah bar.
            setDpQris(null);
            router.push(`/bar/${barSlug}`);
          }}
          onCancelled={() => {
            // Host batalkan transaksi → booking batal. Balik ke denah bar.
            setDpQris(null);
            router.push(`/bar/${barSlug}`);
          }}
          onClose={() => {
            // Tutup tanpa bayar → booking belum terkonfirmasi (host tak boleh
            // buka detail saat DP pending). Balik ke denah bar.
            setDpQris(null);
            router.push(`/bar/${barSlug}`);
          }}
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
  const ALL = "__all__";
  const [activeCat, setActiveCat] = React.useState(ALL);
  const [query, setQuery] = React.useState("");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);
  const filterRef = React.useRef<HTMLDivElement>(null);
  // Foto menu yg sedang diperbesar (lightbox).
  const [photo, setPhoto] = React.useState<{ src: string; alt: string } | null>(
    null
  );

  // Klik di luar panel filter → tutup.
  React.useEffect(() => {
    if (!filterOpen) return;
    function onDoc(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [filterOpen]);

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

  // Daftar kategori induk (parent_name) unik, urut kemunculan pertama.
  const parentOptions = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of menu) {
      const p = c.parent_name;
      if (p && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }, [menu]);

  // Filter: kategori induk terpilih (kalau bukan All) + query nama/deskripsi.
  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const byCat =
      activeCat === ALL
        ? menu
        : menu.filter((c) => c.parent_name === activeCat);
    if (!q) return byCat;
    return byCat
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.description?.toLowerCase().includes(q) ||
            i.tags.some((t) => t.toLowerCase().includes(q))
        ),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu, activeCat, q]);
  const anyMatch = filtered.some((c) => c.items.length > 0);

  // activeCat menyimpan parent_name langsung (bukan id) saat difilter.
  const activeCatName = activeCat === ALL ? null : activeCat;

  // Lookup item utk list keranjang.
  const itemMap = React.useMemo(() => {
    const m = new Map<string, MenuItemLite>();
    for (const c of menu) for (const it of c.items) m.set(it.id, it);
    return m;
  }, [menu]);
  const cartLines = Array.from(local.entries());

  function handleConfirm() {
    onChange(new Map(local));
    onClose();
  }

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

        {/* Search + tombol filter kategori — seragam dgn tab Menu. */}
        <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu…"
              className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
            />
          </div>
          {parentOptions.length > 1 && (
            <div ref={filterRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setFilterOpen((o) => !o)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition",
                  activeCat !== ALL
                    ? "border-primary bg-primary/15 text-primary font-medium"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                )}
                aria-label="Filter by category"
                aria-haspopup="listbox"
                aria-expanded={filterOpen}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>Filter</span>
                {activeCatName && (
                  <span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none">
                    1
                  </span>
                )}
              </button>
              {filterOpen && (
                <div
                  role="listbox"
                  className="absolute right-0 z-30 mt-1.5 min-w-44 max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1 shadow-2xl"
                >
                  <ModalCatOption
                    label="All categories"
                    selected={activeCat === ALL}
                    onClick={() => {
                      setActiveCat(ALL);
                      setFilterOpen(false);
                    }}
                  />
                  {parentOptions.map((p) => (
                    <ModalCatOption
                      key={p}
                      label={p}
                      selected={activeCat === p}
                      onClick={() => {
                        setActiveCat(p);
                        setFilterOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Items list — dikelompokkan per kategori (seperti tab Menu). */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] p-3 space-y-4">
          {!anyMatch ? (
            <p className="text-center text-xs text-muted-foreground py-8">
              {q ? `No menu matches “${query}”.` : "No menu items yet."}
            </p>
          ) : (
            (() => {
              // Hanya sub-kategori yg punya item tampil.
              const visible = filtered.filter((c) => c.items.length > 0);
              let prevParent: string | null | undefined = undefined;
              return visible.map((cat) => {
                // Judul kategori induk hanya saat parent_name berganti.
                const showParentHeading = cat.parent_name !== prevParent;
                prevParent = cat.parent_name;
                return (
                <div key={cat.id} className="space-y-2">
                  {showParentHeading && cat.parent_name && (
                    <h2 className="text-sm font-bold tracking-tight text-foreground">
                      {cat.parent_name}
                    </h2>
                  )}
                  <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {cat.name}
                  </h3>
                  {cat.items.map((item) => {
              const qty = local.get(item.id) ?? 0;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition",
                    qty > 0
                      ? "border-primary/40 bg-primary/[0.06]"
                      : "border-border bg-card/40"
                  )}
                >
                  {/* Thumbnail — klik utk perbesar */}
                  {item.image_url ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPhoto({ src: item.image_url!, alt: item.name })
                      }
                      className="h-12 w-12 shrink-0 rounded-md overflow-hidden bg-muted/40"
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
                    <div className="h-12 w-12 shrink-0 rounded-md bg-muted/40 flex items-center justify-center">
                      <UtensilsCrossed className="h-4 w-4 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-primary tabular-nums">
                      {formatIDR(item.price)}
                    </p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {item.description}
                      </p>
                    )}
                    {/* Tag/chip (mis. signature, alcoholic, spicy) */}
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Stepper — selalu tampil (−/qty/+), pola tab Menu. */}
                  <div className="flex items-center rounded-md border border-border shrink-0">
                    <button
                      type="button"
                      onClick={() => setQty(item.id, qty - 1)}
                      disabled={qty === 0}
                      className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label="Decrease"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-7 text-center text-sm tabular-nums">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQty(item.id, qty + 1)}
                      className="h-8 w-8 flex items-center justify-center text-primary hover:text-primary/80"
                      aria-label="Add"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
                  })}
                </div>
                );
              });
            })()
          )}
        </div>

        {/* Keranjang (collapsible) — bar merah 'N items' + list, seperti tab.
            Sudut atas dibulatkan (rounded-t) biar menonjol dari list di atas. */}
        {itemCount > 0 && (
          <div className="shrink-0 rounded-t-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setCartOpen((v) => !v)}
              className="w-full bg-primary text-primary-foreground flex items-center gap-2 px-4 py-2.5"
            >
              <ShoppingCart className="h-4 w-4 shrink-0" />
              <span className="flex-1 min-w-0 text-sm font-medium truncate text-left">
                {itemCount} item{itemCount > 1 ? "s" : ""} in your order
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold shrink-0">
                {cartOpen ? "Hide" : "View order"}
                {cartOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </span>
            </button>
            {cartOpen && (
              <div className="max-h-[240px] overflow-y-auto [overscroll-behavior:contain] bg-card divide-y divide-border">
                {cartLines.map(([id, qty]) => {
                  const it = itemMap.get(id);
                  if (!it) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{it.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {qty} × {formatIDR(it.price)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setQty(id, qty - 1)}
                          className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"
                          aria-label="Decrease"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-5 text-center text-sm font-medium tabular-nums">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQty(id, qty + 1)}
                          className="h-7 w-7 rounded-md border border-primary/40 bg-primary/15 text-primary flex items-center justify-center hover:bg-primary/25"
                          aria-label="Increase"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setQty(id, 0)}
                          className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-400 flex items-center justify-center"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer: Total order KIRI + tombol Save KANAN (pola tab Menu). */}
        <div className="border-t border-border shrink-0">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-muted-foreground">Total order</p>
              <p className="text-lg font-bold text-primary tabular-nums leading-tight">
                {formatIDR(total)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={itemCount === 0}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              <ShoppingCart className="h-4 w-4" />
              Save order
            </button>
          </div>
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

/** Opsi kategori di dropdown filter modal order awal. */
function ModalCatOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm text-left transition",
        selected
          ? "bg-primary/15 text-primary"
          : "text-foreground hover:bg-muted/60"
      )}
    >
      <span className="truncate">{label}</span>
      {selected && <Check className="h-4 w-4 shrink-0" />}
    </button>
  );
}

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
