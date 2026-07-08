"use client";

import * as React from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Search, UtensilsCrossed } from "lucide-react";
import { formatIDR, cn } from "@/lib/utils";

export interface MenuPickerItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  tags: string[];
  is_available: boolean;
  prep_minutes: number;
}

export interface MenuPickerCategory {
  id: string;
  name: string;
  slug: string;
  /**
   * Nama kategori UTAMA (induk) — untuk heading 2 tingkat. Kategori di sini
   * mewakili SUB-kategori (leaf tempat item berada). null = tanpa induk.
   */
  parent_name?: string | null;
  items: MenuPickerItem[];
}

interface Props {
  menu: MenuPickerCategory[];
  onAdd: (menuItemId: string, quantity: number, notes?: string) => Promise<void>;
}

const ALL_SLUG = "__all__";

export function MenuPicker({ menu, onAdd }: Props) {
  // Default "All" → tampilkan semua menu dalam satu list.
  const [activeCat, setActiveCat] = React.useState<string>(ALL_SLUG);
  const [query, setQuery] = React.useState("");
  const [selectedItem, setSelectedItem] = React.useState<MenuPickerItem | null>(null);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return menu;
    const q = query.toLowerCase();
    return menu
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            it.description?.toLowerCase().includes(q) ||
            it.tags.some((t) => t.toLowerCase().includes(q))
        ),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu, query]);

  // Nama kategori UTAMA (induk) yang berbeda, urut kemunculan pertama.
  // Sub-kategori tanpa induk dikelompokkan di bawah label fallback.
  const NO_PARENT = "Lainnya";
  const parentOf = (cat: MenuPickerCategory) => cat.parent_name ?? NO_PARENT;

  const mainCategories = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const cat of menu) {
      const p = parentOf(cat);
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }, [menu]);

  // Kategori yg ditampilkan: "All" → semua; else → sub-kategori dgn induk terpilih.
  const shownCategories =
    activeCat === ALL_SLUG
      ? filtered
      : filtered.filter((cat) => parentOf(cat) === activeCat);

  return (
    <div className="space-y-3">
      {/* Search + kategori STICKY — nempel DI BAWAH tab bar session saat scroll.
          Header session sticky top-0 (~57px) + tab bar sticky top-[57px].
          top-[101px] = tepat di bawah tab bar (dekat, tanpa celah gede). bg SOLID
          + pt-2 biar item tak nembus tapi jarak ke tab tetap rapat. */}
      <div className="sticky top-[101px] z-20 -mx-4 px-4 pt-2 pb-3 bg-background space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search menu, signature, mocktail..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
          />
        </div>

        {/* Category strip — chip "All" di depan menampilkan semua menu. */}
        {!query && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
            <button
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
            {mainCategories.map((p) => (
              <button
                key={p}
                onClick={() => setActiveCat(p)}
                className={cn(
                  "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition",
                  activeCat === p
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Items — saat search pakai hasil filter; else kategori terpilih/All. */}
      {(() => {
        const list = query ? filtered : shownCategories;
        // Precompute: heading kategori UTAMA tampil saat induk berganti antar
        // sub-kategori yang benar-benar dirender (list sudah difilter).
        const rows = list.map((cat, i) => ({
          cat,
          parent: parentOf(cat),
          showMainHeading: parentOf(cat) !== (i > 0 ? parentOf(list[i - 1]) : null),
        }));
        return rows.map(({ cat, parent, showMainHeading }) => {
          return (
        <div key={cat.id} className="space-y-2">
          {/* Heading kategori UTAMA (2 tingkat) — lebih besar/tebal dari header sub. */}
          {showMainHeading && (
            <h2 className="text-base font-bold tracking-tight text-foreground pt-3">
              {parent}
            </h2>
          )}
          {/* Header kategori tampil saat search / mode "All" (multi kategori). */}
          {(query || activeCat === ALL_SLUG) && (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
              {cat.name}
            </h3>
          )}
          {cat.items.map((item) => (
            <Card
              key={item.id}
              className={cn(
                "p-3 flex gap-3 items-start cursor-pointer hover:border-primary/40 transition",
                !item.is_available && "opacity-50"
              )}
              onClick={() => item.is_available && setSelectedItem(item)}
            >
              {/* Foto menu (thumbnail). Placeholder ikon kalau tak ada foto. */}
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted/40 flex items-center justify-center">
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={item.name}
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UtensilsCrossed className="h-5 w-5 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 mb-1">
                  <p className="font-medium text-sm leading-tight flex-1">{item.name}</p>
                  <span className="text-sm font-semibold text-primary shrink-0">
                    {formatIDR(item.price)}
                  </span>
                </div>
                {item.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">
                    {item.description}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.tags.slice(0, 3).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t}
                    </Badge>
                  ))}
                  <span className="text-[10px] text-muted-foreground ml-1">
                    {item.prep_minutes}m
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
          );
        });
      })()}

      {filtered.length === 0 && (
        <Card className="p-6 text-center border-dashed">
          <p className="text-sm text-muted-foreground">
            No menu matches &quot;{query}&quot;.
          </p>
        </Card>
      )}

      {/* Add to order modal */}
      {selectedItem && (
        <AddItemSheet
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onConfirm={async (qty, notes) => {
            await onAdd(selectedItem.id, qty, notes);
            setSelectedItem(null);
          }}
        />
      )}
    </div>
  );
}

function AddItemSheet({
  item,
  onClose,
  onConfirm,
}: {
  item: MenuPickerItem;
  onClose: () => void;
  onConfirm: (qty: number, notes?: string) => Promise<void>;
}) {
  const [qty, setQty] = React.useState(1);
  const [notes, setNotes] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm(qty, notes.trim() || undefined);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md rounded-b-none sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">{item.name}</h3>
            {item.description && (
              <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
            )}
            <p className="text-primary font-semibold mt-2">{formatIDR(item.price)}</p>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Quantity
            </label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQty(Math.max(1, qty - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="text-xl font-semibold w-10 text-center">{qty}</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQty(Math.min(20, qty + 1))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Notes <span className="font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Less ice, no sugar, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
              className="w-full h-10 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="gold"
              size="lg"
              className="flex-1"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading
                ? "Adding..."
                : `Add ${formatIDR(qty * item.price)}`}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
