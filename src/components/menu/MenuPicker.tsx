"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Search } from "lucide-react";
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
  items: MenuPickerItem[];
}

interface Props {
  menu: MenuPickerCategory[];
  onAdd: (menuItemId: string, quantity: number, notes?: string) => Promise<void>;
}

export function MenuPicker({ menu, onAdd }: Props) {
  const [activeCat, setActiveCat] = React.useState<string>(menu[0]?.slug ?? "");
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

  const activeCategory = filtered.find((c) => c.slug === activeCat) ?? filtered[0];

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          placeholder="Cari menu, signature, mocktail..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full h-11 pl-10 pr-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
        />
      </div>

      {/* Category strip */}
      {!query && (
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
          {menu.map((c) => (
            <button
              key={c.id}
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

      {/* Items */}
      {(query ? filtered : activeCategory ? [activeCategory] : []).map((cat) => (
        <div key={cat.id} className="space-y-2">
          {query && (
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
      ))}

      {filtered.length === 0 && (
        <Card className="p-6 text-center border-dashed">
          <p className="text-sm text-muted-foreground">
            Tidak ada menu yang cocok dengan &quot;{query}&quot;.
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
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
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
              Jumlah
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
              Catatan <span className="font-normal lowercase">(opsional)</span>
            </label>
            <input
              type="text"
              placeholder="Less ice, no sugar, dll"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
              className="w-full h-10 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
              Batal
            </Button>
            <Button
              variant="gold"
              size="lg"
              className="flex-1"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading
                ? "Menambah..."
                : `Tambah ${formatIDR(qty * item.price)}`}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
