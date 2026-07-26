"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMoveTargets, type MoveTargetTable } from "@/lib/move-table-actions";
import { staffMoveTable } from "@/lib/move-approval-actions";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";

/**
 * Tombol staff (kasir/waiter) untuk memindahkan meja sesi LANGSUNG tanpa
 * approval. Pilih meja tujuan → konfirmasi → pindah. Jam booking dipertahankan.
 */
export function StaffMoveTableButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [targets, setTargets] = React.useState<MoveTargetTable[] | null>(null);
  const [confirm, setConfirm] = React.useState<MoveTargetTable | null>(null);
  const [moving, setMoving] = React.useState(false);

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

  async function doMove(t: MoveTargetTable) {
    setMoving(true);
    try {
      await staffMoveTable({ sessionId, targetTableId: t.id });
      toast.success(`Moved to table ${t.label}`);
      setOpen(false);
      setConfirm(null);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to move table"));
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={openModal}
      >
        <ArrowRightLeft className="h-4 w-4" /> Move Table
      </Button>

      {/* Pilih meja tujuan */}
      {open && !confirm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
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
                Only tables with enough capacity & free at the booking time. The
                booking time stays the same, moves instantly without approval.
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
                    onClick={() => setConfirm(t)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:border-primary/50 hover:bg-muted/40 transition flex items-center gap-3"
                  >
                    <span className="h-9 w-9 rounded-md bg-muted border border-border flex items-center justify-center shrink-0 text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">
                        Table {t.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t.area_name} · {t.capacity} seats
                      </span>
                      {t.min_spend > 0 && (
                        <span className="block text-[11px] text-amber-400">
                          Min. spend {formatIDR(t.min_spend)}
                        </span>
                      )}
                    </span>
                  </button>
                ))
              ) : (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No destination tables available.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi */}
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-background border border-border rounded-2xl shadow-2xl p-5">
            <h3 className="text-base font-semibold mb-1">Move table?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This session will be moved to <strong>table {confirm.label}</strong>.
              The booking time stays the same. Takes effect instantly without approval.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={moving}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="gold"
                className="flex-1"
                disabled={moving}
                onClick={() => void doMove(confirm)}
              >
                {moving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Move"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
