"use client";

import * as React from "react";
import { toast } from "sonner";
import { UserPlus, Plus, X, Users, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SlotRangePicker } from "@/components/reservation/SlotRangePicker";
import {
  staffOpenTableForCustomer,
  type AvailableTable,
  type WaiterReservationData,
} from "@/lib/waiter-actions";
import { cn, getActionErrorMessage } from "@/lib/utils";

/**
 * Modal "Buka Meja untuk Tamu" (staff). Dipakai waiter & kasir.
 * Pilih meja kosong + jam booking (SlotRangePicker) + nama tamu.
 */
export function OpenTableModal({
  tables,
  reservationData,
  onClose,
}: {
  tables: AvailableTable[];
  reservationData: WaiterReservationData;
  onClose: () => void;
}) {
  const [guestNames, setGuestNames] = React.useState<string[]>([""]);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = React.useState(false);
  // Jam booking (wajib dipilih saat buka meja).
  const [slotStart, setSlotStart] = React.useState("");
  const [slotEnd, setSlotEnd] = React.useState("");

  const reservationEnabled = reservationData.enabled && reservationData.slots.length > 0;

  const selectedTable = React.useMemo(
    () => tables.find((t) => t.id === selectedTableId) ?? null,
    [tables, selectedTableId]
  );
  const capacity = selectedTable?.capacity ?? 8;

  // Group tables by area
  const groupedTables = React.useMemo(() => {
    const map = new Map<string, AvailableTable[]>();
    for (const t of tables) {
      const list = map.get(t.area_name) ?? [];
      list.push(t);
      map.set(t.area_name, list);
    }
    return Array.from(map.entries());
  }, [tables]);

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
    tables.length > 0 &&
    // Wajib pilih jam KALAU reservasi aktif; kalau bar matikan reservasi → walk-in.
    (!reservationEnabled || !!slotStart);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedTableId) return;
    if (reservationEnabled && !slotStart) {
      toast.error("Pilih jam booking dulu");
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
      const message = getActionErrorMessage(err, "Gagal buka meja");
      toast.error(message);
      setSubmitting(false);
      // Slot keburu dibooking (race) → tutup modal, kembali ke daftar meja
      // terkini supaya staff bisa pilih meja/jam lain.
      if (message.includes("dibooking")) {
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
              <h2 className="text-sm font-semibold">Buka Meja untuk Tamu</h2>
              <p className="text-[11px] text-muted-foreground">
                Untuk tamu yang tidak bawa HP / walk-in
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
                1. Pilih meja kosong
              </label>
              {tables.length === 0 ? (
                <Card className="p-6 text-center border-dashed">
                  <p className="text-xs text-muted-foreground">
                    Semua meja sedang terpakai. Tutup salah satu dulu.
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {groupedTables.map(([area, ts]) => (
                    <div key={area}>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                        {area}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {ts.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setSelectedTableId(t.id)}
                            className={cn(
                              "p-2 rounded-md border text-center transition",
                              selectedTableId === t.id
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-muted/30 hover:border-primary/50"
                            )}
                          >
                            <div className="text-xs font-semibold">
                              {t.label}
                            </div>
                            <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5 mt-0.5">
                              <Users className="h-2.5 w-2.5" />
                              {t.capacity}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pilih jam booking (wajib) */}
            {reservationEnabled && selectedTableId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  2. Pilih jam booking
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
                  3. Nama tamu di meja
                </label>
                {selectedTable && (
                  <span className="text-[10px] text-muted-foreground">
                    {validNamesCount}/{capacity} tamu
                  </span>
                )}
              </div>

              {!selectedTable ? (
                <Card className="p-4 text-center border-dashed">
                  <p className="text-[11px] text-muted-foreground">
                    Pilih meja dulu untuk input nama tamu
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
                            ? "Nama utama (tampil di bill)"
                            : `Nama tamu ${index + 1}`
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
                          aria-label="Hapus tamu"
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
                      Tambah tamu lain
                    </Button>
                  )}

                  <p className="text-[10px] text-muted-foreground mt-1">
                    Nama tamu pertama akan tampil di bill & receipt sebagai
                    pemilik meja.
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
                  Membuka meja...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Buka Meja & Mulai Pesan
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
