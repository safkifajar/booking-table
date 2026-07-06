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
import { Button } from "@/components/ui/button";
import { formatIDR, cn, getActionErrorMessage } from "@/lib/utils";
import type { MenuPickerCategory } from "@/components/menu/MenuPicker";

export interface CartLine {
  menuItemId: string;
  quantity: number;
}

const ALL_SLUG = "__all__";

/**
 * Menu WAITER berbasis KERANJANG. Tiap item cuma +/- (tanpa tombol Tambah
 * per baris): + menambah ke keranjang, - mengurangi. Ringkasan keranjang +
 * tombol "Simpan Pesanan" sticky di bawah → semua masuk bill sekali simpan.
 */
export function StaffMenuGrid({
  menu,
  onSave,
  cart: controlledCart,
  onCartChange,
}: {
  menu: MenuPickerCategory[];
  onSave: (cart: CartLine[]) => Promise<void>;
  /** Cart controlled dari luar (biar persist saat pindah tab). Opsional —
   *  kalau tak diberi, pakai state internal. */
  cart?: Record<string, number>;
  onCartChange?: (next: Record<string, number>) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [internalCart, setInternalCart] = React.useState<
    Record<string, number>
  >({});
  // Controlled kalau parent kasih cart+onCartChange; else internal.
  const cart = controlledCart ?? internalCart;
  const setCart = React.useCallback(
    (updater: React.SetStateAction<Record<string, number>>) => {
      if (controlledCart !== undefined && onCartChange) {
        const next =
          typeof updater === "function"
            ? (updater as (p: Record<string, number>) => Record<string, number>)(
                controlledCart
              )
            : updater;
        onCartChange(next);
      } else {
        setInternalCart(updater);
      }
    },
    [controlledCart, onCartChange]
  );
  const [saving, setSaving] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);
  // Filter kategori. ALL_SLUG = tampilkan semua kategori.
  const [activeCat, setActiveCat] = React.useState<string>(ALL_SLUG);

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    // 1. Filter kategori (kalau bukan "All").
    const byCat =
      activeCat === ALL_SLUG
        ? menu
        : menu.filter((c) => c.slug === activeCat);
    // 2. Filter query (nama/deskripsi/tag).
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
  }, [menu, q, activeCat]);

  // Lookup harga/nama/foto untuk ringkasan keranjang.
  const itemMap = React.useMemo(() => {
    const m = new Map<
      string,
      { name: string; price: number; image_url: string | null }
    >();
    menu.forEach((c) =>
      c.items.forEach((i) =>
        m.set(i.id, { name: i.name, price: i.price, image_url: i.image_url })
      )
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
      {/* Search + kategori STICKY — nempel di bawah tab bar session saat scroll.
          Header session sticky top-0 (~57px) + tab bar top-[57px] → ~101px.
          bg solid biar item tak nembus di belakang. */}
      <div className="sticky top-[101px] z-20 -mx-4 px-4 pt-2 pb-3 bg-background space-y-3">
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

        {/* Filter kategori — chip "All" + per kategori. */}
        {!q && menu.length > 1 && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
          <button
            type="button"
            onClick={() => setActiveCat(ALL_SLUG)}
            className={cn(
              "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition",
              activeCat === ALL_SLUG
                ? "bg-primary/15 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          {menu.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCat(c.slug)}
              className={cn(
                "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition",
                activeCat === c.slug
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
        )}
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
                    "flex items-start gap-3 rounded-lg border p-3 transition",
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
                    {/* Deskripsi */}
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {item.description}
                      </p>
                    )}
                    {/* Tag */}
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

      {/* Bar keranjang — CARD MENGAMBANG ala Traveloka: margin dari tepi, rounded,
          shadow, warna SOHO. Panel ringkasan expand di dalam card (di atas aksi). */}
      {totalQty > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3 pointer-events-none">
          <div className="max-w-3xl mx-auto rounded-2xl border border-primary/25 bg-card shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden pointer-events-auto">
            <div className="p-3 space-y-2">
            {/* Panel ringkasan keranjang (expand) — di ATAS baris aksi */}
            {cartOpen && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/30 divide-y divide-border">
                {cartLines.map((l) => {
                  const info = itemMap.get(l.menuItemId);
                  return (
                    <div
                      key={l.menuItemId}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      {/* Foto menu (thumbnail) */}
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-muted/40 flex items-center justify-center">
                        {info?.image_url ? (
                          <Image
                            src={info.image_url}
                            alt={info.name}
                            width={32}
                            height={32}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground/40" />
                        )}
                      </div>
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

            {/* Baris aksi: info harga (kiri, clickable → toggle panel) + tombol
                Save menonjol (kanan) — ala Traveloka, warna SOHO. */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCartOpen((v) => !v)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex items-center gap-1 text-[11px] font-medium text-primary">
                  {cartOpen ? "Hide order" : "View order"}
                  {cartOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronUp className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="text-lg font-bold text-foreground tabular-nums leading-tight">
                  {formatIDR(totalPrice)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {totalQty} item{totalQty > 1 ? "s" : ""}
                </div>
              </button>
              <Button
                type="button"
                variant="gold"
                size="lg"
                onClick={handleSave}
                disabled={saving}
                className="shrink-0 px-6"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="h-4 w-4" />
                )}
                Save order
              </Button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
