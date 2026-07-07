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
  Trash2,
  SlidersHorizontal,
  Check,
} from "lucide-react";
import { toast } from "sonner";
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
  const [filterOpen, setFilterOpen] = React.useState(false);
  const filterRef = React.useRef<HTMLDivElement>(null);

  // Klik di luar panel filter → tutup.
  React.useEffect(() => {
    if (!filterOpen) return;
    function onDoc(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [filterOpen]);

  // Label kategori aktif utk badge tombol filter.
  const activeCatName =
    activeCat === ALL_SLUG
      ? null
      : (menu.find((c) => c.slug === activeCat)?.name ?? null);

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

  // Ref tiap baris cart (utk auto-scroll ke item yg baru ditambah) + id terakhir.
  const cartRowRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const [lastAddedId, setLastAddedId] = React.useState<string | null>(null);

  function inc(id: string) {
    setCart((c) => ({ ...c, [id]: Math.min(20, (c[id] ?? 0) + 1) }));
    setLastAddedId(id);
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
  // Hapus item sepenuhnya dari keranjang (tombol tong sampah).
  function remove(id: string) {
    setCart((c) => {
      const copy = { ...c };
      delete copy[id];
      return copy;
    });
  }

  const cartLines: CartLine[] = Object.entries(cart).map(
    ([menuItemId, quantity]) => ({ menuItemId, quantity })
  );
  const totalQty = cartLines.reduce((a, l) => a + l.quantity, 0);

  // Auto-scroll list cart ke item yg baru ditambah (kalau panel terbuka) supaya
  // yg baru langsung kelihatan walau list panjang.
  React.useEffect(() => {
    if (!lastAddedId || !cartOpen) return;
    cartRowRefs.current[lastAddedId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [lastAddedId, cartOpen, cart]);
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
    <div className="h-full flex flex-col min-h-0">
      {/* Search + tombol filter kategori — DIAM (shrink-0, di luar area scroll
          list di bawah). Tak bergerak sedikit pun saat list di-scroll. */}
      <div className="shrink-0 pb-3 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu…"
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
        </div>
        {menu.length > 1 && (
          <div ref={filterRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition",
                activeCat !== ALL_SLUG
                  ? "border-primary bg-primary/15 text-primary font-medium"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
              )}
              aria-label="Filter by category"
              aria-haspopup="listbox"
              aria-expanded={filterOpen}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Filter</span>
              {activeCatName && (
                <span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none">
                  1
                </span>
              )}
            </button>

            {filterOpen && (
              <div
                role="listbox"
                className="absolute right-0 z-30 mt-1.5 min-w-44 max-h-60 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl"
              >
                <CatOption
                  label="All categories"
                  selected={activeCat === ALL_SLUG}
                  onClick={() => {
                    setActiveCat(ALL_SLUG);
                    setFilterOpen(false);
                  }}
                />
                {menu.map((c) => (
                  <CatOption
                    key={c.id}
                    label={c.name}
                    selected={activeCat === c.slug}
                    onClick={() => {
                      setActiveCat(c.slug);
                      setFilterOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* List menu — SATU area scroll (flex-1 mengisi sisa; search di atas
          diam). pb-28 beri ruang bar keranjang 'fixed' biar item terakhir tak
          ketutupan. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 pb-28 -mx-1 px-1">
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
      </div>

      {totalQty > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30">
          {/* Container membesar saat dibuka: HEADER MERAH (rounded-top) + list
              produk BG GELAP di bawahnya. Menyatu, nempel, radius atas saja. */}
          <div className="rounded-t-2xl overflow-hidden">
            {/* Header banner MERAH — klik toggle buka/tutup */}
            <button
              type="button"
              onClick={() => setCartOpen((v) => !v)}
              className="w-full bg-primary text-primary-foreground"
            >
              <div className="max-w-3xl mx-auto flex items-center gap-2 px-4 sm:px-6 py-2.5">
                <ShoppingCart className="h-4 w-4 shrink-0" />
                <span className="flex-1 min-w-0 text-sm font-medium truncate text-left">
                  {totalQty} item{totalQty > 1 ? "s" : ""} in your order
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold shrink-0">
                  {cartOpen ? "Hide" : "View order"}
                  {cartOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </span>
              </div>
            </button>

            {/* List produk — BG GELAP (card), muncul saat dibuka. Maks tinggi
                ~6 produk (≈44px/baris); lebih → scroll. overscroll contain →
                scroll cart tak nembus ke list menu di belakang. */}
            {cartOpen && (
              <div className="max-h-[264px] overflow-y-auto [overscroll-behavior:contain] bg-card">
                <div className="max-w-3xl mx-auto divide-y divide-border">
                  {cartLines.map((l) => {
                    const info = itemMap.get(l.menuItemId);
                    return (
                      <div
                        key={l.menuItemId}
                        ref={(el) => {
                          cartRowRefs.current[l.menuItemId] = el;
                        }}
                        className="flex items-center gap-2 px-4 sm:px-6 py-2 text-sm"
                      >
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
                          onClick={() => remove(l.menuItemId)}
                          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-400 shrink-0"
                          aria-label="Remove item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Bar bawah: harga KIRI + tombol Save KANAN (pola Traveloka). */}
          <div className="border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground">Total order</p>
                <p className="text-lg font-bold text-primary tabular-nums leading-tight">
                  {formatIDR(totalPrice)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="shrink-0 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="h-4 w-4" />
                )}
                Save order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Opsi kategori di dropdown filter menu. */
function CatOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm text-left transition",
        selected
          ? "bg-primary/15 text-primary"
          : "text-foreground hover:bg-muted/60"
      )}
    >
      <span className="truncate">{label}</span>
      {selected && <Check className="h-4 w-4 shrink-0" />}
    </button>
  );
}
