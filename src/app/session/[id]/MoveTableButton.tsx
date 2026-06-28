"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMoveTargets,
  moveTable,
  type MoveTargetTable,
} from "@/lib/move-table-actions";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Tombol "Pindah Meja" + modal pilih meja tujuan. Fase 1: hanya sesi 'reserved'
 * (belum jam booking) — pindah langsung tanpa approval.
 */
export function MoveTableButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [targets, setTargets] = React.useState<MoveTargetTable[] | null>(null);
  const [moving, setMoving] = React.useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    try {
      setTargets(await getMoveTargets(sessionId));
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal memuat meja"));
      setTargets([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMove(t: MoveTargetTable) {
    setMoving(t.id);
    try {
      await moveTable({ sessionId, targetTableId: t.id });
      toast.success(`Berhasil pindah ke meja ${t.label}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal pindah meja"));
    } finally {
      setMoving(null);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="w-full" onClick={openModal}>
        <ArrowRightLeft className="h-4 w-4" /> Pindah Meja
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <h2 className="text-sm font-semibold">Pindah ke meja lain</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
                aria-label="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-muted-foreground mb-2">
                Hanya meja yang slot waktunya kosong & kapasitasnya cukup. Durasi
                booking tetap sama.
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
                    onClick={() => handleMove(t)}
                    disabled={moving !== null}
                    className="w-full flex items-center gap-3 rounded-lg border border-border p-3 text-left transition hover:bg-muted/40 disabled:opacity-50"
                  >
                    <div className="h-9 w-9 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">Meja {t.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.area_name} · {t.capacity} kursi
                      </div>
                    </div>
                    {moving === t.id && (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    )}
                  </button>
                ))
              ) : (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Tak ada meja tersedia untuk slot ini.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
