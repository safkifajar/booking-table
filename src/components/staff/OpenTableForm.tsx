"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  X,
  Users,
  Loader2,
  UtensilsCrossed,
  ChevronRight,
  Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import { FloorMap, type FloorMapTable } from "@/components/floor/FloorMap";
import { StaffMenuGrid } from "@/components/menu/StaffMenuGrid";
import type { MenuPickerCategory } from "@/components/menu/MenuPicker";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";
import { computeBillTotals, type ChargeConfig } from "@/lib/settings-constants";
import type { FloorArea } from "@/types/db";
import {
  staffOpenTableForCustomer,
  type WaiterReservationData,
} from "@/lib/waiter-actions";
import { searchCustomersForTableHost } from "@/lib/staff-customer-actions";
import { previewVoucherForOpenTable } from "@/lib/membership-actions";
import { cn, formatIDR, getActionErrorMessage } from "@/lib/utils";

/**
 * Halaman "Open Table for Guest" (staff, walk-in). Pilih meja lewat DENAH LANTAI
 * (sama seperti tampilan customer) + jam booking + nama tamu.
 *
 * Versi HALAMAN PENUH (bukan bottom sheet) — denah lantai butuh ruang, dan
 * memilih meja di peta jauh lebih jelas di layar penuh.
 */
export function OpenTableForm({
  floorMap,
  reservationData,
  menu,
  chargeConfig,
  backHref,
  hostCustomer,
}: {
  floorMap: Array<{ area: FloorArea; tables: FloorMapTable[] }>;
  reservationData: WaiterReservationData;
  /** Menu bar untuk pilih pesanan awal (wajib — tamu bayar dulu). */
  menu: MenuPickerCategory[];
  /** Config tax & service — untuk ringkasan tagihan (sama seperti customer).
   *  Server tetap otoritatif; ini hanya tampilan. */
  chargeConfig: ChargeConfig;
  /** Ke mana tombol "Back" mengarah (dashboard asal: waiter/cashier). */
  backHref: string;
  /**
   * Kalau diisi (dibuka dari menu Customers), meja dibuka ATAS NAMA akun
   * pelanggan ini — tagihan & riwayat menempel ke akunnya.
   */
  hostCustomer?: { id: string; name: string; phone: string | null } | null;
}) {
  const router = useRouter();
  const [guestNames, setGuestNames] = React.useState<string[]>([
    hostCustomer?.name ?? "",
  ]);
  /**
   * Akun pelanggan per BARIS tamu (sejajar dgn guestNames). null = nama manual
   * (walk-in). Baris 0 = pemilik meja. Kalau halaman dibuka dari menu Customers
   * (?customer=), baris 0 langsung terisi pelanggan itu.
   */
  const [guestAccounts, setGuestAccounts] = React.useState<
    ({ id: string; name: string; phone: string | null } | null)[]
  >([hostCustomer ?? null]);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [slotStart, setSlotStart] = React.useState("");
  const [slotEnd, setSlotEnd] = React.useState("");
  // Cart pesanan awal (wajib) + metode bayar di muka.
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [payMethod, setPayMethod] = React.useState<"qris" | "cash">("qris");
  // QR yang sedang ditampilkan setelah submit (QRIS).
  const [qr, setQr] = React.useState<{
    paymentId: string;
    qrString: string;
    amount: number;
    sessionId: string;
  } | null>(null);

  // Lookup nama+harga item + hitung total (untuk tampilan; server otoritatif).
  const itemLookup = React.useMemo(() => {
    const m = new Map<string, { name: string; price: number }>();
    for (const cat of menu)
      for (const it of cat.items) m.set(it.id, { name: it.name, price: it.price });
    return m;
  }, [menu]);
  const cartLines = React.useMemo(
    () =>
      Object.entries(cart)
        .filter(([, q]) => q > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
    [cart]
  );
  const cartCount = cartLines.reduce((s, l) => s + l.quantity, 0);
  const cartSubtotal = cartLines.reduce(
    (s, l) => s + (itemLookup.get(l.menuItemId)?.price ?? 0) * l.quantity,
    0
  );
  // Tagihan: subtotal + tax & service. computeBillTotals SAMA dgn server, jadi
  // angka tombol = angka yang di-charge (dulu tombol pakai subtotal → beda).
  const bill = React.useMemo(
    () => computeBillTotals(cartSubtotal, chargeConfig),
    [cartSubtotal, chargeConfig]
  );

  // Voucher — hanya bisa dipakai kalau ADA tamu yang akun terdaftar. Boleh
  // milik anggota mana pun di meja ini, tak harus pemilik meja.
  const [voucherInput, setVoucherInput] = React.useState("");
  const [voucherChecking, setVoucherChecking] = React.useState(false);
  const [voucherError, setVoucherError] = React.useState<string | null>(null);
  const [voucher, setVoucher] = React.useState<{
    code: string;
    name: string;
    discount: number;
  } | null>(null);
  const voucherOwnerIds = React.useMemo(
    () => guestAccounts.filter((a) => a !== null).map((a) => a!.id),
    [guestAccounts]
  );
  const canUseVoucher = voucherOwnerIds.length > 0;
  const discount = voucher ? Math.min(voucher.discount, bill.total) : 0;
  const payableTotal = Math.max(0, bill.total - discount);
  // Potongan menutup seluruh tagihan → tak ada yang ditagih ke gateway.
  const fullyCovered = voucher !== null && payableTotal === 0;

  // Semua akun dilepas (diganti nama manual) → voucher ikut dibuang supaya
  // tak terkirim diam-diam.
  React.useEffect(() => {
    if (!canUseVoucher && voucher) {
      setVoucher(null);
      setVoucherInput("");
    }
  }, [canUseVoucher, voucher]);

  // Nominal berubah (item ditambah/dikurangi) → potongan bisa tak lagi valid
  // (mis. minimum belanja). Buang, biar kasir menerapkannya ulang.
  React.useEffect(() => {
    setVoucher(null);
  }, [bill.total]);

  async function applyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code || bill.total <= 0) return;
    setVoucherChecking(true);
    setVoucherError(null);
    try {
      const res = await previewVoucherForOpenTable({
        code,
        amount: bill.total,
        ownerIds: voucherOwnerIds,
      });
      if (!res.ok) {
        // Di field, bukan cuma toast — toast keburu hilang sebelum dibaca.
        setVoucherError(res.error);
        return;
      }
      setVoucher({ code: res.code, name: res.name, discount: res.discount });
      toast.success(`Voucher applied: -${formatIDR(res.discount)}`);
    } catch {
      setVoucherError("Failed to check voucher. Try again");
    } finally {
      setVoucherChecking(false);
    }
  }

  const [activeAreaSlug, setActiveAreaSlug] = React.useState(
    floorMap[0]?.area.slug ?? ""
  );
  const activeArea =
    floorMap.find((a) => a.area.slug === activeAreaSlug) ?? floorMap[0] ?? null;

  const reservationEnabled =
    reservationData.enabled && reservationData.slots.length > 0;

  // Meja terpilih diambil dari DENAH (punya koordinat + capacity).
  const selectedTable = React.useMemo(() => {
    for (const { tables: ts } of floorMap) {
      const hit = ts.find((t) => t.id === selectedTableId);
      if (hit) return hit;
    }
    return null;
  }, [floorMap, selectedTableId]);
  const capacity = selectedTable?.capacity ?? 8;

  // Trim daftar tamu kalau pindah ke meja berkapasitas lebih kecil.
  React.useEffect(() => {
    if (selectedTable && guestNames.length > selectedTable.capacity) {
      setGuestNames((prev) => prev.slice(0, selectedTable.capacity));
      setGuestAccounts((prev) => prev.slice(0, selectedTable.capacity));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableId]);

  function updateGuestName(index: number, value: string) {
    setGuestNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }
  function addGuest() {
    if (guestNames.length >= capacity) return;
    setGuestNames((prev) => [...prev, ""]);
    setGuestAccounts((prev) => [...prev, null]);
  }
  function removeGuest(index: number) {
    if (guestNames.length <= 1) return;
    setGuestNames((prev) => prev.filter((_, i) => i !== index));
    setGuestAccounts((prev) => prev.filter((_, i) => i !== index));
  }

  /** Pilih akun pelanggan untuk baris tertentu (nama ikut terisi). */
  function pickGuestAccount(
    index: number,
    c: { id: string; name: string; phone: string | null }
  ) {
    setGuestAccounts((prev) => {
      const next = [...prev];
      next[index] = c;
      return next;
    });
    setGuestNames((prev) => {
      const next = [...prev];
      next[index] = c.name;
      return next;
    });
  }

  /** Kembalikan baris ke input nama manual. */
  function clearGuestAccount(index: number) {
    setGuestAccounts((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setGuestNames((prev) => {
      const next = [...prev];
      next[index] = "";
      return next;
    });
  }

  const validNamesCount = guestNames.filter((n) => n.trim().length > 0).length;
  const slotMs = reservationData.slotIntervalMinutes * 60 * 1000;
  const effectiveEnd =
    slotEnd ||
    (slotStart
      ? new Date(new Date(slotStart).getTime() + slotMs).toISOString()
      : "");
  const canSubmit =
    !submitting &&
    selectedTableId !== null &&
    validNamesCount > 0 &&
    cartLines.length > 0 &&
    (!reservationEnabled || !!slotStart);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedTableId) return;
    if (reservationEnabled && !slotStart) {
      toast.error("Select a booking time first");
      return;
    }
    if (cartLines.length === 0) {
      toast.error("Add at least one menu item first");
      return;
    }
    setSubmitting(true);
    try {
      // Server membuang nama kosong (cleanNames) — kirim akun yang SUDAH
      // diselaraskan dgn baris non-kosong supaya indeksnya tetap cocok.
      const filled = guestNames
        .map((n, i) => ({ name: n.trim(), account: guestAccounts[i] ?? null }))
        .filter((r) => r.name.length > 0);

      const result = await staffOpenTableForCustomer({
        tableId: selectedTableId,
        guestNames: filled.map((r) => r.name),
        reservationAt: slotStart || null,
        reservationEndAt: slotStart ? effectiveEnd : null,
        items: cartLines,
        payMethod,
        memberProfileIds: filled.map((r) => r.account?.id ?? null),
        voucherCode: canUseVoucher ? voucher?.code : undefined,
      });
      // Gagal validasi (voucher tak berlaku / keburu dipakai) → pesannya
      // di result.error, bukan exception (pesan throw disensor Next.js).
      if (result.ok === false) {
        toast.error(result.error);
        setVoucher(null);
        setSubmitting(false);
        return;
      }
      // Kasir buka meja + cash → sudah langsung lunas. Meja terbuka, ke sesi.
      if ("paid" in result) {
        toast.success("Payment received. Table opened");
        router.push(`/session/${result.sessionId}`);
        return;
      }
      // Bayar di kasir (waiter yang buka) → layar tunggu konfirmasi (10 mnt).
      if ("awaitCashier" in result) {
        router.push(`/booking/${result.sessionId}/pay`);
        return;
      }
      // QRIS pending → tampilkan QR; meja terbuka begitu dibayar.
      if ("qris" in result) {
        setQr({
          paymentId: result.qris.paymentId,
          qrString: result.qris.qrString,
          // Nominal SETELAH potongan voucher — yang benar-benar ditagih.
          amount: payableTotal,
          sessionId: result.sessionId,
        });
        setSubmitting(false);
        return;
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      if (raw.includes("NEXT_REDIRECT")) throw err;
      const message = getActionErrorMessage(err, "Failed to open table");
      toast.error(message);
      setSubmitting(false);
      if (message.toLowerCase().includes("booked")) {
        router.push(backHref);
      }
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      {/* Header halaman */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-base font-semibold">
            {guestAccounts[0]
              ? "Open Table for Customer"
              : "Open Table for Guest"}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {guestAccounts[0]
              ? `On behalf of ${guestAccounts[0].name}`
              : "For guests without a phone / walk-in"}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mx-auto max-w-lg px-4 py-5 space-y-5">
        {/* 1. Pilih meja lewat denah */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            1. Select a table
          </label>
          {!activeArea ? (
            <Card className="p-6 text-center border-dashed">
              <p className="text-xs text-muted-foreground">
                No floor plan set up yet.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {/* Tab area — kalau bar punya lebih dari satu area. */}
              {floorMap.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {floorMap.map(({ area }) => (
                    <button
                      key={area.slug}
                      type="button"
                      onClick={() => setActiveAreaSlug(area.slug)}
                      className={cn(
                        "shrink-0 rounded-full border px-3 h-8 text-xs transition",
                        area.slug === activeAreaSlug
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      {area.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Denah lantai — sama seperti yang dilihat customer. Meja merah =
                  sedang dipakai; tetap bisa dipilih (server yang validasi akhir). */}
              <div className="rounded-lg border border-border overflow-hidden bg-background">
                <FloorMap
                  key={activeArea.area.slug}
                  canvasWidth={activeArea.area.canvas_width}
                  canvasHeight={activeArea.area.canvas_height}
                  tables={activeArea.tables}
                  selectedTableId={selectedTableId}
                  onSelectTable={(t) => setSelectedTableId(t.id)}
                />
              </div>

              {selectedTable ? (
                <div className="flex items-center justify-between rounded-md bg-primary/10 border border-primary/30 px-3 py-2 text-sm">
                  <span className="font-medium text-primary">
                    Table {selectedTable.label}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {selectedTable.capacity} seats
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-1">
                  Tap a table on the map to select it.
                </p>
              )}
            </div>
          )}
        </div>

        {/* 2. Jam booking (wajib kalau reservasi aktif) */}
        {reservationEnabled && selectedTableId && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              2. Select a booking time
            </label>
            <SlotRangePicker
              slots={reservationData.slots}
              bookedSlotIsos={reservationData.bookedByTable[selectedTableId] ?? []}
              slotIntervalMinutes={reservationData.slotIntervalMinutes}
              bookingWindowDays={reservationData.bookingWindowDays}
              startIso={slotStart}
              endIso={slotEnd}
              onChange={(start, end) => {
                setSlotStart(start);
                setSlotEnd(end);
              }}
            />
          </div>
        )}

        {/* 3. Nama tamu */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              3. Guest names at the table
            </label>
            {selectedTable && (
              <span className="text-[10px] text-muted-foreground">
                {validNamesCount}/{capacity} guests
              </span>
            )}
          </div>

          {!selectedTable ? (
            <Card className="p-4 text-center border-dashed">
              <p className="text-[11px] text-muted-foreground">
                Select a table first to enter guest names
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {/* Pemilik meja: nama manual (walk-in) atau akun pelanggan. */}
              {/* Tiap baris: ketik nama manual ATAU cari & pilih pelanggan. */}
              {guestNames.map((name, index) => (
                <GuestRow
                  key={index}
                  index={index}
                  name={name}
                  account={guestAccounts[index] ?? null}
                  canRemove={guestNames.length > 1}
                  // Pelanggan yang sudah dipilih di baris lain disembunyikan
                  // dari hasil cari (1 orang tak bisa dobel di satu meja).
                  excludeIds={guestAccounts
                    .filter((a, i) => !!a && i !== index)
                    .map((a) => a!.id)}
                  onName={(v) => updateGuestName(index, v)}
                  onPick={(c) => pickGuestAccount(index, c)}
                  onClearAccount={() => clearGuestAccount(index)}
                  onRemove={() => removeGuest(index)}
                />
              ))}

              {guestNames.length < capacity && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addGuest}
                  className="w-full border border-dashed border-border text-muted-foreground hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add another guest
                </Button>
              )}

              <p className="text-[10px] text-muted-foreground mt-1">
                The first guest name will appear on the bill & receipt as the
                table owner.
              </p>
            </div>
          )}
        </div>

        {/* 4. Pesanan awal (WAJIB — tamu bayar dulu) */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            4. Order &amp; pay{" "}
            <span className="text-primary font-normal">(required)</span>
          </label>
          {menu.length === 0 ? (
            <Card className="p-4 text-center border-dashed">
              <p className="text-[11px] text-muted-foreground">
                No menu set up yet.
              </p>
            </Card>
          ) : cartCount === 0 ? (
            // Tombol pemicu — pilih menu di HALAMAN/modal penuh sendiri (pola
            // customer), bukan grid tertanam yang scroll-nya bentrok di form.
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="w-full flex items-center justify-between gap-2 p-3 rounded-md border border-dashed border-border hover:border-primary/50 transition text-sm text-muted-foreground"
            >
              <span className="flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4" />
                Pick menu items
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            // Sudah ada isi → daftar item + tombol ubah (pola customer).
            <div className="rounded-md border border-border overflow-hidden">
              <div className="divide-y divide-border">
                {cartLines.map((l) => {
                  const item = itemLookup.get(l.menuItemId);
                  if (!item) return null;
                  return (
                    <div
                      key={l.menuItemId}
                      className="flex items-center justify-between gap-2 p-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-primary font-medium mr-1">
                          {l.quantity}×
                        </span>
                        <span className="truncate">{item.name}</span>
                      </div>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {formatIDR(item.price * l.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="w-full p-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition border-t border-border flex items-center justify-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Edit / add order
              </button>
            </div>
          )}

          {/* Ringkasan tagihan — sama seperti customer. Tax & service ikut
              dibayar di muka, jadi ditampilkan. Server otoritatif. */}
          {cartCount > 0 && (
            <div className="mt-3 rounded-md bg-muted/40 border border-border p-3 space-y-1.5 text-sm">
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
              {discount > 0 && (
                <>
                  <div className="flex items-center justify-between text-primary">
                    <span className="truncate">Voucher ({voucher!.code})</span>
                    <span className="font-semibold tabular-nums">
                      -{formatIDR(discount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5">
                    <span className="text-muted-foreground">Amount to pay</span>
                    <span className="font-semibold tabular-nums">
                      {formatIDR(payableTotal)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Voucher — hanya kalau ada tamu yang akun terdaftar. */}
          {cartCount > 0 && canUseVoucher && (
            <div className="mt-3">
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Voucher (optional)
              </label>
              {voucher ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {voucher.name} ({voucher.code})
                    </p>
                    <p className="text-xs text-primary">
                      -{formatIDR(discount)}
                      {fullyCovered ? " · fully covered" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVoucher(null);
                      setVoucherInput("");
                    }}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <div className="relative flex-1 min-w-0">
                      <input
                        type="text"
                        value={voucherInput}
                        onChange={(e) => {
                          setVoucherInput(e.target.value);
                          if (voucherError) setVoucherError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            applyVoucher();
                          }
                        }}
                        placeholder="Voucher code"
                        aria-invalid={!!voucherError}
                        className={cn(
                          "w-full h-10 rounded-md border bg-background pl-3 pr-9 text-sm uppercase focus:outline-none",
                          voucherError
                            ? "border-destructive focus:border-destructive"
                            : "border-border focus:border-primary/60"
                        )}
                      />
                      {voucherInput && (
                        <button
                          type="button"
                          aria-label="Clear voucher code"
                          onClick={() => {
                            setVoucherInput("");
                            setVoucherError(null);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={applyVoucher}
                      disabled={voucherChecking || !voucherInput.trim()}
                      className="shrink-0"
                    >
                      {voucherChecking ? "…" : "Apply"}
                    </Button>
                  </div>
                  {voucherError && (
                    <p className="mt-1 text-xs text-destructive">
                      {voucherError}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 5. Metode bayar */}
        {/* Tagihan tertutup penuh voucher → tak ada yang ditagih, jadi
            pilihan metode bayar tak relevan. */}
        {cartCount > 0 && !fullyCovered && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              5. Payment method
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["qris", "cash"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayMethod(m)}
                  className={cn(
                    "rounded-lg border h-11 text-sm font-medium transition",
                    payMethod === m
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {m === "qris" ? "QRIS now" : "Cash"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer aksi */}
        <div className="sticky bottom-0 -mx-4 px-4 py-4 bg-background border-t border-border">
          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={!canSubmit}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {bill.total <= 0
                  ? "Pick menu items to continue"
                  : fullyCovered
                    ? // Voucher menutup semuanya → tak ada yang ditagih.
                      "Open table · covered by voucher"
                    : `${payMethod === "qris" ? "Pay" : "Charge cash"} · ${formatIDR(payableTotal)}`}
              </>
            )}
          </Button>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Table opens once payment is received. Service charge added at
            checkout.
          </p>
        </div>
      </form>

      {/* Pemilih menu — overlay penuh, scroll sendiri (StaffMenuGrid memang
          dirancang penuh-layar; di dalam form ia bentrok). Tombol "Done"
          menutup; cart controlled sudah tersimpan. */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Pick menu items</span>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="h-8 w-8 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* px-4 sm:px-6: StaffMenuGrid mengharapkan parent berpadding —
              search & kartu ikut padding, sedang bar cart bawah pakai -mx untuk
              "bleed" balik ke tepi. Tanpa ini konten mepet dinding. */}
          <div className="flex-1 min-h-0 px-4 sm:px-6 pt-4">
            <StaffMenuGrid
              menu={menu}
              cart={cart}
              onCartChange={setCart}
              saveLabel="Done"
              // "Done" cuma menutup overlay — cart JANGAN dikosongkan; masih
              // dipakai untuk pilih metode bayar + submit di form utama.
              clearOnSave={false}
              onSave={async () => {
                setMenuOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {/* QRIS: tampil setelah submit. Lunas → meja terbuka, ke halaman sesi. */}
      {qr && (
        <QrisPaymentDialog
          paymentId={qr.paymentId}
          qrString={qr.qrString}
          amount={qr.amount}
          onPaid={() => {
            toast.success("Payment received. Table opened");
            router.push(`/session/${qr.sessionId}`);
          }}
          onClose={() => setQr(null)}
        />
      )}
    </div>
  );
}

/**
 * Satu baris tamu: ketik nama manual (walk-in) ATAU cari & pilih akun
 * pelanggan terdaftar. Baris yang menunjuk akun → kunjungan tercatat di akun
 * orang tersebut (bukan guest baru).
 */
function GuestRow({
  index,
  name,
  account,
  canRemove,
  excludeIds,
  onName,
  onPick,
  onClearAccount,
  onRemove,
}: {
  index: number;
  name: string;
  account: { id: string; name: string; phone: string | null } | null;
  canRemove: boolean;
  /** Pelanggan yang sudah dipakai baris lain — disaring dari hasil cari. */
  excludeIds: string[];
  onName: (v: string) => void;
  onPick: (c: { id: string; name: string; phone: string | null }) => void;
  onClearAccount: () => void;
  onRemove: () => void;
}) {
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const excludeKey = excludeIds.join(",");
  const [results, setResults] = React.useState<
    { id: string; name: string; phone: string | null }[]
  >([]);
  const [loading, setLoading] = React.useState(false);

  // Debounce pencarian (300ms).
  React.useEffect(() => {
    if (!searching) return;
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchCustomersForTableHost(q)
        .then(
          (rows) =>
            alive && setResults(rows.filter((r) => !excludeIds.includes(r.id)))
        )
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // excludeKey (string) dipakai sbg dep supaya array baru tiap render tak
    // memicu effect berulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searching, excludeKey]);

  const numberBadge = (
    <div className="flex items-center justify-center h-9 w-7 shrink-0 rounded-md bg-muted/50 text-[10px] font-medium text-muted-foreground">
      {index + 1}
    </div>
  );

  // Sudah menunjuk akun pelanggan → tampilkan kartunya.
  if (account) {
    return (
      <div className="flex items-center gap-2">
        {numberBadge}
        <div className="flex flex-1 items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.07] px-3 py-2 min-w-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{account.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {account.phone ?? "Registered customer"}
              {index === 0 ? " · table owner" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClearAccount();
              setSearching(false);
              setQuery("");
              setResults([]);
            }}
            className="shrink-0 text-[11px] font-medium text-primary hover:underline"
          >
            Change
          </button>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive flex items-center justify-center"
            aria-label="Remove guest"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {numberBadge}
        {searching ? (
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, username, or phone…"
              className="w-full py-2 pl-9 pr-3 bg-muted/50 border border-border rounded-md text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <input
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={
              index === 0 ? "Main name (shown on bill)" : `Guest name ${index + 1}`
            }
            maxLength={80}
            className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-md text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
          />
        )}
        {/* Toggle: ketik manual ↔ cari pelanggan */}
        <button
          type="button"
          onClick={() => {
            setSearching((s) => !s);
            setQuery("");
            setResults([]);
          }}
          aria-label={searching ? "Type name manually" : "Pick registered customer"}
          title={searching ? "Type name manually" : "Pick registered customer"}
          className={cn(
            "h-9 w-9 shrink-0 rounded-md border flex items-center justify-center transition",
            searching
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          {searching ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive flex items-center justify-center"
            aria-label="Remove guest"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Hasil pencarian pelanggan */}
      {searching && results.length > 0 && (
        <div className="ml-9 overflow-hidden rounded-lg border border-border bg-card">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onPick(c);
                setSearching(false);
                setQuery("");
                setResults([]);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-muted/50"
            >
              <span className="text-sm font-medium truncate">{c.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {c.phone ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}
      {searching && !loading && query.trim().length > 0 && results.length === 0 && (
        <p className="ml-9 text-[11px] text-muted-foreground">
          No customer found. Type the name manually instead.
        </p>
      )}
    </div>
  );
}
