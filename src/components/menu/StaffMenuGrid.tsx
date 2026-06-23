"use client";

import * as React from "react";
import { Search, Minus, Plus, Loader2 } from "lucide-react";
import { formatIDR, cn } from "@/lib/utils";
import type { MenuPickerCategory } from "@/components/menu/MenuPicker";

/**
 * Grid menu untuk WAITER — tiap item punya stepper qty (+/-) langsung di list,
 * tanpa bottom sheet. Atur qty lalu klik "Tambah" untuk kirim 1 pesanan.
 * onAdd dipanggil dgn (menuItemId, quantity). Setelah sukses, qty di-reset ke 1.
 */
export function StaffMenuGrid({
  menu,
  onAdd,
}: {
  menu: MenuPickerCategory[];
  onAdd: (menuItemId: string, quantity: number) => Promise<void>;
}) {
  const [query, setQuery] = React.useState("");

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

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari menu…"
          className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Menu tidak ditemukan.
        </p>
      )}

      {filtered.map((cat) => (
        <div key={cat.id}>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {cat.name}
          </h3>
          <div className="space-y-2">
            {cat.items.map((item) => (
              <MenuRow key={item.id} item={item} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MenuRow({
  item,
  onAdd,
}: {
  item: MenuPickerCategory["items"][number];
  onAdd: (menuItemId: string, quantity: number) => Promise<void>;
}) {
  const [qty, setQty] = React.useState(1);
  const [adding, setAdding] = React.useState(false);

  async function handleAdd() {
    setAdding(true);
    try {
      await onAdd(item.id, qty);
      setQty(1); // reset setelah sukses
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3",
        !item.is_available && "opacity-50"
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.name}</p>
        <p className="text-xs text-primary tabular-nums">
          {formatIDR(item.price)}
          {!item.is_available && (
            <span className="ml-1.5 text-muted-foreground">· Habis</span>
          )}
        </p>
      </div>

      {item.is_available && (
        <div className="flex items-center gap-2 shrink-0">
          {/* Stepper qty */}
          <div className="flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={() => setQty((v) => Math.max(1, v - 1))}
              disabled={qty <= 1}
              className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              aria-label="Kurangi"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-7 text-center text-sm tabular-nums">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((v) => Math.min(20, v + 1))}
              disabled={qty >= 20}
              className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              aria-label="Tambah"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {adding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Tambah"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
