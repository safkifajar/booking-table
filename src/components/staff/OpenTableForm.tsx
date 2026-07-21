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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import { FloorMap, type FloorMapTable } from "@/components/floor/FloorMap";
import { StaffMenuGrid } from "@/components/menu/StaffMenuGrid";
import type { MenuPickerCategory } from "@/components/menu/MenuPicker";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";
import type { FloorArea } from "@/types/db";
import {
  staffOpenTableForCustomer,
  type WaiterReservationData,
} from "@/lib/waiter-actions";
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
  backHref,
}: {
  floorMap: Array<{ area: FloorArea; tables: FloorMapTable[] }>;
  reservationData: WaiterReservationData;
  /** Menu bar untuk pilih pesanan awal (wajib — tamu bayar dulu). */
  menu: MenuPickerCategory[];
  /** Ke mana tombol "Back" mengarah (dashboard asal: waiter/cashier). */
  backHref: string;
}) {
  const router = useRouter();
  const [guestNames, setGuestNames] = React.useState<string[]>([""]);
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

  // Lookup harga item + hitung total (untuk tampilan; server tetap otoritatif).
  const itemPrice = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const cat of menu) for (const it of cat.items) m.set(it.id, it.price);
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
    (s, l) => s + (itemPrice.get(l.menuItemId) ?? 0) * l.quantity,
    0
  );

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
  }
  function removeGuest(index: number) {
    if (guestNames.length <= 1) return;
    setGuestNames((prev) => prev.filter((_, i) => i !== index));
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
      const result = await staffOpenTableForCustomer({
        tableId: selectedTableId,
        guestNames,
        reservationAt: slotStart || null,
        reservationEndAt: slotStart ? effectiveEnd : null,
        items: cartLines,
        payMethod,
      });
      // Bayar di kasir → arahkan ke layar tunggu konfirmasi (countdown 10 mnt).
      if ("awaitCashier" in result) {
        router.push(`/booking/${result.sessionId}/pay`);
        return;
      }
      // QRIS pending → tampilkan QR; meja terbuka begitu dibayar.
      if ("qris" in result) {
        setQr({
          paymentId: result.qris.paymentId,
          qrString: result.qris.qrString,
          amount: cartSubtotal,
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
          <h1 className="text-base font-semibold">Open Table for Guest</h1>
          <p className="text-[11px] text-muted-foreground">
            For guests without a phone / walk-in
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
              {guestNames.map((name, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-9 w-7 shrink-0 rounded-md bg-muted/50 text-[10px] font-medium text-muted-foreground">
                    {index + 1}
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => updateGuestName(index, e.target.value)}
                    placeholder={
                      index === 0
                        ? "Main name (shown on bill)"
                        : `Guest name ${index + 1}`
                    }
                    maxLength={80}
                    className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-md text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                  />
                  {guestNames.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeGuest(index)}
                      className="h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive flex items-center justify-center"
                      aria-label="Remove guest"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
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
            // Sudah ada isi → ringkasan + tombol ubah.
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="w-full rounded-md border border-primary/30 bg-primary/5 p-3 text-left transition hover:border-primary/50"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-primary">
                  {cartCount} item{cartCount > 1 ? "s" : ""}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  {formatIDR(cartSubtotal)}
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Tap to edit the order
              </p>
            </button>
          )}
        </div>

        {/* 5. Metode bayar */}
        {cartCount > 0 && (
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
                  {m === "qris" ? "QRIS now" : "Pay at cashier"}
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
                {cartSubtotal > 0
                  ? `${payMethod === "qris" ? "Pay" : "Confirm at cashier"} · ${formatIDR(cartSubtotal)}`
                  : "Add items to continue"}
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
            toast.success("Payment received — table opened");
            router.push(`/session/${qr.sessionId}`);
          }}
          onClose={() => setQr(null)}
        />
      )}
    </div>
  );
}
