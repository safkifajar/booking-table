"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, X, MapPin, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMoveTargets,
  getMoveTableSlots,
  moveTable,
  moveTableWithOrder,
  type MoveTargetTable,
  type MoveSlotData,
} from "@/lib/move-table-actions";
import {
  requestMoveTable,
  requestMoveTableWithOrder,
} from "@/lib/move-approval-actions";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import type { MenuPickerCategory } from "@/components/menu/MenuPicker";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";

type PayMethod = "qris" | "cash";

/**
 * Tombol "Pindah Meja" + modal. Fase 1: sesi 'reserved'.
 * - Meja tanpa min-spend → pindah langsung.
 * - Meja ber-min-spend & order belum capai → modal order: tambah item s/d
 *   min-spend + bayar selisih → baru pindah (moveTableWithOrder).
 */
export function MoveTableButton({
  sessionId,
  status,
  menu,
  existingOrderTotal,
  pendingMove,
}: {
  sessionId: string;
  status: string;
  menu: MenuPickerCategory[];
  existingOrderTotal: number;
  pendingMove: { toLabel: string; reservationAt: string } | null;
}) {
  const router = useRouter();
  // Aktif (open/locked) → request + approval. reserved → pindah langsung.
  const needsApproval = status === "open" || status === "locked";
  // Badge "menunggu approval" — sumber utama dari server prop (realtime ikut
  // router.refresh). State lokal cuma utk optimistic sesaat setelah submit.
  const [optimisticPending, setOptimisticPending] = React.useState<{
    toLabel: string;
    reservationAt: string;
  } | null>(null);
  const pending = pendingMove ?? optimisticPending;
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [targets, setTargets] = React.useState<MoveTargetTable[] | null>(null);
  // Meja yg dipilih → masuk step pilih jam.
  const [slotTarget, setSlotTarget] = React.useState<MoveTargetTable | null>(
    null
  );
  // {target, slotIso} → masuk modal order (min-spend).
  const [orderStep, setOrderStep] = React.useState<{
    target: MoveTargetTable;
    slotIso: string;
  } | null>(null);
  const [moving, setMoving] = React.useState(false);
  // Popup konfirmasi min-spend sebelum pilih jam.
  const [confirmMinSpend, setConfirmMinSpend] =
    React.useState<MoveTargetTable | null>(null);

  // Saat server konfirmasi tak ada pending lagi (di-approve/reject), bersihkan
  // optimistic supaya badge ikut hilang realtime.
  React.useEffect(() => {
    if (pendingMove === null) setOptimisticPending(null);
  }, [pendingMove]);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    try {
      setTargets(await getMoveTargets(sessionId));
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to load tables"));
      setTargets([]);
    } finally {
      setLoading(false);
    }
  }

  function handlePick(t: MoveTargetTable) {
    // Meja ber-min-spend & order belum cukup → popup konfirmasi dulu
    // (berlaku utk pindah langsung MAUPUN request approval).
    if (t.min_spend > 0 && existingOrderTotal < t.min_spend) {
      setConfirmMinSpend(t);
      return;
    }
    // Mode aktif: TAK pilih jam (pindah berlaku sekarang→jam selesai) → langsung
    // ajukan request. Mode reserved: lanjut ke step pilih jam.
    if (needsApproval) {
      submitActiveRequest(t);
      return;
    }
    setSlotTarget(t);
  }

  // Mode aktif tanpa min-spend issue → request langsung (tanpa jam).
  async function submitActiveRequest(t: MoveTargetTable) {
    setMoving(true);
    try {
      await requestMoveTable({ sessionId, targetTableId: t.id });
      toast.success("Move request sent — waiting for staff approval");
      setOpen(false);
      setConfirmMinSpend(null);
      setOptimisticPending({
        toLabel: t.label,
        reservationAt: new Date().toISOString(),
      });
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to send request"));
    } finally {
      setMoving(false);
    }
  }

  // Mode reserved — setelah pilih jam.
  async function handleSlotChosen(t: MoveTargetTable, slotIso: string) {
    // Min-spend kurang → modal order dulu.
    if (t.min_spend > 0 && existingOrderTotal < t.min_spend) {
      setOrderStep({ target: t, slotIso });
      setSlotTarget(null);
      return;
    }
    setMoving(true);
    try {
      await moveTable({
        sessionId,
        targetTableId: t.id,
        reservationAt: slotIso,
      });
      toast.success(`Moved to table ${t.label}`);
      setOpen(false);
      setSlotTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to move table"));
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      {pending ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>
            Waiting for staff approval — moving to table{" "}
            <strong>{pending.toLabel}</strong>.
          </span>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={openModal}
        >
          <ArrowRightLeft className="h-4 w-4" />{" "}
          {needsApproval ? "Request Table Move" : "Move Table"}
        </Button>
      )}

      {/* Step 1: pilih meja */}
      {open && !slotTarget && !orderStep && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <h2 className="text-sm font-semibold">Move to another table</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-muted-foreground mb-2">
                {needsApproval
                  ? "Only tables with enough capacity and free during your booking time. Your booking time stays the same — moving only changes the table and needs staff approval."
                  : "Only tables with enough capacity. The booking duration stays the same; you pick the start time in the next step."}
              </p>
              {loading ? (
                <div className="py-10 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : targets && targets.length > 0 ? (
                targets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handlePick(t)}
                    className="w-full flex items-center gap-3 rounded-lg border border-border p-3 text-left transition hover:bg-muted/40"
                  >
                    <div className="h-9 w-9 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">Table {t.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.area_name} · {t.capacity} seats
                      </div>
                      {t.min_spend > 0 && (
                        <div className="text-[11px] text-amber-400 mt-0.5">
                          Min. spend {formatIDR(t.min_spend)}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No tables available.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* #1 Popup konfirmasi min-spend */}
      {confirmMinSpend && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-5 text-center">
            <h3 className="text-base font-bold mb-1">Table has a minimum spend</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Table {confirmMinSpend.label} has a minimum spend of{" "}
              <span className="text-amber-400 font-semibold">
                {formatIDR(confirmMinSpend.min_spend)}
              </span>
              . You need to add an order and pay first to move here.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmMinSpend(null)}
              >
                Cancel
              </Button>
              <Button
                variant="gold"
                className="flex-1"
                onClick={() => {
                  if (needsApproval) {
                    // Mode aktif: tak pilih jam → langsung modal order.
                    setOrderStep({ target: confirmMinSpend, slotIso: "" });
                  } else {
                    setSlotTarget(confirmMinSpend);
                  }
                  setConfirmMinSpend(null);
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: pilih jam di meja tujuan */}
      {slotTarget && (
        <SlotPickStep
          sessionId={sessionId}
          target={slotTarget}
          moving={moving}
          onBack={() => setSlotTarget(null)}
          onChoose={(iso) => handleSlotChosen(slotTarget, iso)}
        />
      )}

      {/* Step 3: order (min-spend) — dgn jam terpilih */}
      {orderStep && (
        <MoveOrderModal
          sessionId={sessionId}
          target={orderStep.target}
          slotIso={orderStep.slotIso}
          menu={menu}
          existingOrderTotal={existingOrderTotal}
          needsApproval={needsApproval}
          onBack={() => setOrderStep(null)}
          onDone={() => {
            if (needsApproval) {
              setOptimisticPending({
                toLabel: orderStep.target.label,
                reservationAt:
                  orderStep.slotIso || new Date().toISOString(),
              });
            }
            setOrderStep(null);
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/* ---------- Step pilih jam (pakai SlotRangePicker — konsisten open table) ---------- */
function SlotPickStep({
  sessionId,
  target,
  moving,
  onBack,
  onChoose,
}: {
  sessionId: string;
  target: MoveTargetTable;
  moving: boolean;
  onBack: () => void;
  onChoose: (iso: string) => void;
}) {
  const [data, setData] = React.useState<MoveSlotData | null>(null);
  const [startIso, setStartIso] = React.useState("");
  const [endIso, setEndIso] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    getMoveTableSlots(sessionId, target.id)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [sessionId, target.id]);

  // Konflik: rentang [start, end) menabrak slot yg sudah dibooking di meja
  // tujuan (durasi terkunci bisa melewati slot booked walau jam mulai kosong).
  const rangeConflict = React.useMemo(() => {
    if (!startIso || !endIso || !data) return false;
    const booked = new Set(data.bookedSlotIsos);
    const slotMs = data.slotIntervalMinutes * 60 * 1000;
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    for (let t = startMs; t < endMs; t += slotMs) {
      if (booked.has(new Date(t).toISOString())) return true;
    }
    return false;
  }, [startIso, endIso, data]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Pick a time · Table {target.label}</h2>
            <p className="text-[11px] text-muted-foreground">
              Duration stays the same as the original booking
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Back"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {data === null ? (
            <div className="py-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : data.slots.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-xs text-primary">
                Move duration{" "}
                <strong>matches your previous booking ({durasiLabel(data.durationMinutes)})</strong>
                . Just pick a start time — the end time follows automatically.
              </div>
              <SlotRangePicker
                slots={data.slots}
                bookedSlotIsos={data.bookedSlotIsos}
                slotIntervalMinutes={data.slotIntervalMinutes}
                bookingWindowDays={data.bookingWindowDays}
                startIso={startIso}
                endIso={endIso}
                lockedDurationMs={data.durationMinutes * 60 * 1000}
                onChange={(s, e) => {
                  setStartIso(s);
                  setEndIso(e);
                }}
              />
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No times available at this table.
            </div>
          )}
        </div>
        {data && data.slots.length > 0 && (
          <div className="p-4 border-t border-border shrink-0 space-y-2">
            {rangeConflict && (
              <p className="text-[11px] text-amber-400">
                This time range conflicts with another booking at the target
                table. Pick a different start time.
              </p>
            )}
            <Button
              variant="gold"
              size="lg"
              className="w-full"
              disabled={!startIso || rangeConflict || moving}
              onClick={() => startIso && !rangeConflict && onChoose(startIso)}
            >
              {moving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing…
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Modal order utk min-spend ---------- */
function MoveOrderModal({
  sessionId,
  target,
  slotIso,
  menu,
  existingOrderTotal,
  needsApproval,
  onBack,
  onDone,
}: {
  sessionId: string;
  target: MoveTargetTable;
  slotIso: string;
  menu: MenuPickerCategory[];
  existingOrderTotal: number;
  needsApproval: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  const [cart, setCart] = React.useState<Map<string, number>>(new Map());
  const [method, setMethod] = React.useState<PayMethod>("qris");
  const [activeCat, setActiveCat] = React.useState(menu[0]?.id ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  const itemPrice = React.useMemo(() => {
    const m = new Map<string, { name: string; price: number }>();
    for (const c of menu)
      for (const i of c.items) m.set(i.id, { name: i.name, price: i.price });
    return m;
  }, [menu]);

  const addedTotal = React.useMemo(() => {
    let t = 0;
    for (const [id, qty] of cart) t += (itemPrice.get(id)?.price ?? 0) * qty;
    return t;
  }, [cart, itemPrice]);

  const grandTotal = existingOrderTotal + addedTotal;
  const shortfall = Math.max(0, target.min_spend - grandTotal);
  const enough = shortfall === 0;

  function setQty(id: string, qty: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }

  async function handleSubmit() {
    if (!enough) {
      toast.error("Minimum spend not reached");
      return;
    }
    const items = Array.from(cart.entries())
      .filter(([, q]) => q > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    if (items.length === 0) {
      toast.error("Add at least 1 item");
      return;
    }
    setSubmitting(true);
    try {
      if (needsApproval) {
        // Mode aktif: tak kirim jam (server set sekarang→jam selesai).
        await requestMoveTableWithOrder({
          sessionId,
          targetTableId: target.id,
          items,
          paymentMethod: method,
        });
        toast.success("Payment successful — move request waiting for approval");
      } else {
        await moveTableWithOrder({
          sessionId,
          targetTableId: target.id,
          reservationAt: slotIso,
          items,
          paymentMethod: method,
        });
        toast.success(`Payment successful & moved to table ${target.label}`);
      }
      onDone();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to move"));
      setSubmitting(false);
    }
  }

  const cat = menu.find((c) => c.id === activeCat) ?? menu[0];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Table {target.label} · min spend</h2>
            <p className="text-[11px] text-muted-foreground">
              Min. {formatIDR(target.min_spend)} — add an order & pay first
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Back"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Kategori */}
        <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-border shrink-0">
          {menu.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCat(c.id)}
              className={
                "px-3 py-1 rounded-full text-xs whitespace-nowrap " +
                (activeCat === c.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground")
              }
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cat?.items
            .filter((i) => i.is_available)
            .map((item) => {
              const qty = cart.get(item.id) ?? 0;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2.5 rounded-md border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.name}</div>
                    <div className="text-xs text-primary font-semibold">
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
            })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border shrink-0 space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Order sekarang</span>
            <span>{formatIDR(existingOrderTotal)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Tambahan</span>
            <span>{formatIDR(addedTotal)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span className={enough ? "text-emerald-400" : "text-amber-400"}>
              {formatIDR(grandTotal)}
            </span>
          </div>
          {!enough && (
            <p className="text-[11px] text-amber-400">
              Kurang {formatIDR(shortfall)} untuk capai minimum spend.
            </p>
          )}

          {/* Metode bayar */}
          <div className="flex gap-2 pt-1">
            {(["qris", "cash"] as PayMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={
                  "flex-1 h-9 rounded-md border text-xs font-medium uppercase " +
                  (method === m
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground")
                }
              >
                {m}
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="gold"
            size="lg"
            className="w-full"
            onClick={handleSubmit}
            disabled={!enough || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Memproses…
              </>
            ) : (
              `Bayar ${formatIDR(addedTotal)} & Pindah`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "3 jam" / "1 jam 30 menit" / "45 menit" dari total menit. */
function durasiLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}
