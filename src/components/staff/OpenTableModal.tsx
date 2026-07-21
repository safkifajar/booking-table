"use client";

import * as React from "react";
import { toast } from "sonner";
import { UserPlus, Plus, X, Users, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import { FloorMap, type FloorMapTable } from "@/components/floor/FloorMap";
import type { FloorArea } from "@/types/db";
import {
  staffOpenTableForCustomer,
  type WaiterReservationData,
} from "@/lib/waiter-actions";
import { cn, getActionErrorMessage } from "@/lib/utils";

/**
 * Modal "Buka Meja untuk Tamu" (staff). Dipakai waiter & kasir.
 * Pilih meja lewat DENAH LANTAI (sama seperti tampilan customer) + jam booking
 * (SlotRangePicker) + nama tamu.
 */
export function OpenTableModal({
  floorMap,
  reservationData,
  onClose,
}: {
  /** Denah lantai per area (koordinat + status) — sumber pilih meja. */
  floorMap: Array<{ area: FloorArea; tables: FloorMapTable[] }>;
  reservationData: WaiterReservationData;
  onClose: () => void;
}) {
  // Area denah yang sedang ditampilkan (tab). Default area pertama.
  const [activeAreaSlug, setActiveAreaSlug] = React.useState(
    floorMap[0]?.area.slug ?? ""
  );
  const activeArea =
    floorMap.find((a) => a.area.slug === activeAreaSlug) ?? floorMap[0] ?? null;
  const [guestNames, setGuestNames] = React.useState<string[]>([""]);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = React.useState(false);
  // Jam booking (wajib dipilih saat buka meja).
  const [slotStart, setSlotStart] = React.useState("");
  const [slotEnd, setSlotEnd] = React.useState("");

  const reservationEnabled = reservationData.enabled && reservationData.slots.length > 0;

  // Meja terpilih diambil dari DENAH (punya koordinat + capacity), bukan lagi
  // dari daftar AvailableTable.
  const selectedTable = React.useMemo(() => {
    for (const { tables: ts } of floorMap) {
      const hit = ts.find((t) => t.id === selectedTableId);
      if (hit) return hit;
    }
    return null;
  }, [floorMap, selectedTableId]);
  const capacity = selectedTable?.capacity ?? 8;

  // Trim guest list kalau pilih meja dengan capacity lebih kecil
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
  // Selesai efektif (1 slot kalau baru pilih mulai) — utk kirim reservationEndAt.
  const slotMs = reservationData.slotIntervalMinutes * 60 * 1000;
  const effectiveEnd =
    slotEnd || (slotStart ? new Date(new Date(slotStart).getTime() + slotMs).toISOString() : "");
  const canSubmit =
    !submitting &&
    selectedTableId !== null &&
    validNamesCount > 0 &&
    // Wajib pilih jam KALAU reservasi aktif; kalau bar matikan reservasi → walk-in.
    (!reservationEnabled || !!slotStart);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedTableId) return;
    if (reservationEnabled && !slotStart) {
      toast.error("Select a booking time first");
      return;
    }

    setSubmitting(true);
    try {
      await staffOpenTableForCustomer(
        selectedTableId,
        guestNames,
        slotStart || null,
        slotStart ? effectiveEnd : null
      );
      // Redirect handled by server action — no toast needed
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      if (raw.includes("NEXT_REDIRECT")) throw err;
      const message = getActionErrorMessage(err, "Failed to open table");
      toast.error(message);
      setSubmitting(false);
      // Slot keburu dibooking (race) → tutup modal, kembali ke daftar meja
      // terkini supaya staff bisa pilih meja/jam lain.
      if (message.toLowerCase().includes("booked")) {
        onClose();
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Open Table for Guest</h2>
              <p className="text-[11px] text-muted-foreground">
                For guests without a phone / walk-in
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Pilih meja DULU karena capacity-nya nentuin max tamu */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                1. Select an empty table
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

                  {/* Denah lantai — sama seperti yang dilihat customer. Meja
                      merah = sedang dipakai; tetap bisa dipilih (server yang
                      validasi akhir). */}
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

                  {/* Ringkasan meja terpilih — di denah label kecil, jadi
                      pertegas di sini. */}
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

            {/* Pilih jam booking (wajib) */}
            {reservationEnabled && selectedTableId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  2. Select a booking time
                </label>
                <SlotRangePicker
                  slots={reservationData.slots}
                  bookedSlotIsos={
                    reservationData.bookedByTable[selectedTableId] ?? []
                  }
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

            {/* Daftar nama tamu — disabled kalau belum pilih meja */}
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
                        autoFocus={index === 0}
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
                    The first guest name will appear on the bill & receipt as
                    the table owner.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 p-4 bg-background border-t border-border shrink-0">
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
                  Opening table...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Open Table & Start Ordering
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
