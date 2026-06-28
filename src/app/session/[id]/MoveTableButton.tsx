"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, X, MapPin, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMoveTargets,
  moveTable,
  moveTableWithOrder,
  type MoveTargetTable,
} from "@/lib/move-table-actions";
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
  menu,
  existingOrderTotal,
}: {
  sessionId: string;
  menu: MenuPickerCategory[];
  existingOrderTotal: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [targets, setTargets] = React.useState<MoveTargetTable[] | null>(null);
  const [moving, setMoving] = React.useState<string | null>(null);
  const [orderTarget, setOrderTarget] = React.useState<MoveTargetTable | null>(
    null
  );

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

  async function handlePick(t: MoveTargetTable) {
    // Min-spend & order belum cukup → buka modal order.
    if (t.min_spend > 0 && existingOrderTotal < t.min_spend) {
      setOrderTarget(t);
      return;
    }
    // Langsung pindah.
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

      {open && !orderTarget && (
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
                Hanya meja yg slot waktunya kosong & kapasitasnya cukup. Durasi
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
                    onClick={() => handlePick(t)}
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
                      {t.min_spend > 0 && (
                        <div className="text-[11px] text-amber-400 mt-0.5">
                          Min. spend {formatIDR(t.min_spend)}
                        </div>
                      )}
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

      {orderTarget && (
        <MoveOrderModal
          sessionId={sessionId}
          target={orderTarget}
          menu={menu}
          existingOrderTotal={existingOrderTotal}
          onBack={() => setOrderTarget(null)}
          onDone={() => {
            setOrderTarget(null);
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/* ---------- Modal order utk min-spend ---------- */
function MoveOrderModal({
  sessionId,
  target,
  menu,
  existingOrderTotal,
  onBack,
  onDone,
}: {
  sessionId: string;
  target: MoveTargetTable;
  menu: MenuPickerCategory[];
  existingOrderTotal: number;
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
      toast.error("Belum capai minimum spend");
      return;
    }
    const items = Array.from(cart.entries())
      .filter(([, q]) => q > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    if (items.length === 0) {
      toast.error("Tambah minimal 1 item");
      return;
    }
    setSubmitting(true);
    try {
      await moveTableWithOrder({
        sessionId,
        targetTableId: target.id,
        items,
        paymentMethod: method,
      });
      toast.success(`Bayar berhasil & pindah ke meja ${target.label}`);
      onDone();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal pindah"));
      setSubmitting(false);
    }
  }

  const cat = menu.find((c) => c.id === activeCat) ?? menu[0];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-background border border-border sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Meja {target.label} · min spend</h2>
            <p className="text-[11px] text-muted-foreground">
              Min. {formatIDR(target.min_spend)} — tambah order & bayar dulu
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Kembali"
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
