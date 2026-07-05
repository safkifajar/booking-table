"use client";

import * as React from "react";
import Image from "next/image";
import {
  Search,
  Minus,
  Plus,
  Loader2,
  ShoppingCart,
  ChevronUp,
  ChevronDown,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { formatIDR, cn, getActionErrorMessage } from "@/lib/utils";
import type { MenuPickerCategory } from "@/components/menu/MenuPicker";

export interface CartLine {
  menuItemId: string;
  quantity: number;
}

/**
 * Menu WAITER berbasis KERANJANG. Tiap item cuma +/- (tanpa tombol Tambah
 * per baris): + menambah ke keranjang, - mengurangi. Ringkasan keranjang +
 * tombol "Simpan Pesanan" sticky di bawah → semua masuk bill sekali simpan.
 */
export function StaffMenuGrid({
  menu,
  onSave,
}: {
  menu: MenuPickerCategory[];
  onSave: (cart: CartLine[]) => Promise<void>;
}) {
  const [query, setQuery] = React.useState("");
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [saving, setSaving] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!q) return menu;
    return menu
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => i.name.toLowerCase().includes(q)),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu, q]);

  // Lookup harga/nama untuk ringkasan keranjang.
  const itemMap = React.useMemo(() => {
    const m = new Map<string, { name: string; price: number }>();
    menu.forEach((c) =>
      c.items.forEach((i) => m.set(i.id, { name: i.name, price: i.price }))
    );
    return m;
  }, [menu]);

  function inc(id: string) {
    setCart((c) => ({ ...c, [id]: Math.min(20, (c[id] ?? 0) + 1) }));
  }
  function dec(id: string) {
    setCart((c) => {
      const next = (c[id] ?? 0) - 1;
      const copy = { ...c };
      if (next <= 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }

  const cartLines: CartLine[] = Object.entries(cart).map(
    ([menuItemId, quantity]) => ({ menuItemId, quantity })
  );
  const totalQty = cartLines.reduce((a, l) => a + l.quantity, 0);
  const totalPrice = cartLines.reduce(
    (a, l) => a + l.quantity * (itemMap.get(l.menuItemId)?.price ?? 0),
    0
  );

  async function handleSave() {
    if (cartLines.length === 0) return;
    setSaving(true);
    try {
      await onSave(cartLines);
      setCart({}); // kosongkan keranjang setelah tersimpan
      setCartOpen(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save order"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search menu…"
          className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No menu found.
        </p>
      )}

      {filtered.map((cat) => (
        <div key={cat.id}>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {cat.name}
          </h3>
          <div className="space-y-2">
            {cat.items.map((item) => {
              const qty = cart[item.id] ?? 0;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 transition",
                    qty > 0
                      ? "border-primary/40 bg-primary/[0.04]"
                      : "border-border bg-card/40",
                    !item.is_available && "opacity-50"
                  )}
                >
                  {/* Foto menu (thumbnail) */}
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted/40 flex items-center justify-center">
                    {item.image_url ? (
                      <Image
                        src={item.image_url}
                        alt={item.name}
                        width={48}
                        height={48}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UtensilsCrossed className="h-4 w-4 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-primary tabular-nums">
                      {formatIDR(item.price)}
                      {!item.is_available && (
                        <span className="ml-1.5 text-muted-foreground">
                          · Sold out
                        </span>
                      )}
                    </p>
                  </div>

                  {item.is_available && (
                    <div className="flex items-center rounded-md border border-border shrink-0">
                      <button
                        type="button"
                        onClick={() => dec(item.id)}
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
                        onClick={() => inc(item.id)}
                        disabled={qty >= 20}
                        className="h-8 w-8 flex items-center justify-center text-primary hover:text-primary/80 disabled:opacity-30"
                        aria-label="Add"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Bar keranjang sticky — Lihat pesanan (expand) + Simpan Pesanan */}
      {totalQty > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 space-y-2">
            {/* Tombol toggle lihat ordernan */}
            <button
              type="button"
              onClick={() => setCartOpen((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition"
            >
              <span className="font-medium">
                {cartOpen ? "Hide" : "View"} order ({totalQty} items)
              </span>
              {cartOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>

            {/* Panel ringkasan keranjang (expand) */}
            {cartOpen && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-card/60 divide-y divide-border">
                {cartLines.map((l) => {
                  const info = itemMap.get(l.menuItemId);
                  return (
                    <div
                      key={l.menuItemId}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <span className="w-6 text-center text-xs font-semibold text-primary tabular-nums shrink-0">
                        {l.quantity}×
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {info?.name ?? "—"}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                        {formatIDR(l.quantity * (info?.price ?? 0))}
                      </span>
                      <button
                        type="button"
                        onClick={() => dec(l.menuItemId)}
                        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground shrink-0"
                        aria-label="Decrease"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShoppingCart className="h-4 w-4" />
              )}
              Save Order · {totalQty} items · {formatIDR(totalPrice)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
