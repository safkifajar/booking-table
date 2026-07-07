"use client";

import * as React from "react";
import Image from "next/image";
import { UtensilsCrossed, Search } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import type { MenuCategory, MenuItem } from "@/types/db";

type MenuCategoryWithItems = MenuCategory & { items: MenuItem[] };

/**
 * Daftar menu READ-ONLY (lihat saja, tanpa cart/pesan) — dipakai di tab Menu
 * halaman denah. Untuk pesan beneran ada MenuPicker di dalam session.
 * Item habis (is_available=false) ditandai redup + label. Ada search by nama.
 */
export function MenuList({ menu }: { menu: MenuCategoryWithItems[] }) {
  const [query, setQuery] = React.useState("");
  // Filter kategori — "all" = semua. Hanya kategori yg punya item.
  const [category, setCategory] = React.useState("all");

  const hasItems = menu.some((c) => c.items.length > 0);
  if (!hasItems) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <UtensilsCrossed className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium mb-1">Menu not available yet</p>
        <p className="text-xs text-muted-foreground">
          No menu items to show yet.
        </p>
      </div>
    );
  }

  // Opsi dropdown kategori: "All" + kategori yg punya item.
  const categoryOptions = [
    { value: "all", label: "All categories" },
    ...menu
      .filter((c) => c.items.length > 0)
      .map((c) => ({ value: c.id, label: c.name })),
  ];

  // Filter: kategori terpilih (kalau bukan "all") + nama menu (case-insensitive).
  // Kategori tanpa hasil disembunyikan.
  const q = query.trim().toLowerCase();
  const filtered = menu
    .filter((cat) => category === "all" || cat.id === category)
    .map((cat) => ({
      ...cat,
      items: q
        ? cat.items.filter((i) => i.name.toLowerCase().includes(q))
        : cat.items,
    }));
  const anyMatch = filtered.some((c) => c.items.length > 0);

  return (
    <div className="space-y-4">
      {/* Search by nama menu + filter kategori (dropdown di samping) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu…"
            className="w-full h-11 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </div>
        <Select
          value={category}
          onChange={setCategory}
          options={categoryOptions}
          ariaLabel="Filter by category"
          align="right"
          className="w-36 shrink-0"
        />
      </div>

      {!anyMatch ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {q
              ? `No menu matches “${query}”.`
              : "No menu in this category."}
          </p>
        </div>
      ) : (
        // Hanya list menu yg scroll (search box di atas tetap diam).
        // overscroll-contain cegah scroll bocor ke halaman saat mentok.
        <div className="space-y-6 max-h-[60vh] overflow-y-auto overscroll-contain pr-0.5">
      {filtered.map((cat) =>
        cat.items.length === 0 ? null : (
          <section key={cat.id}>
            <h2 className="text-xs uppercase tracking-widest font-semibold text-foreground/80 mb-3">
              {cat.name}
            </h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {cat.items.map((item) => {
                const habis = !item.is_available;
                return (
                  <div
                    key={item.id}
                    className={
                      "flex items-center gap-3 p-3" + (habis ? " opacity-50" : "")
                    }
                  >
                    <div className="relative h-14 w-14 rounded-lg overflow-hidden bg-muted/40 shrink-0 flex items-center justify-center">
                      {/* Ikon garpu-sendok = placeholder saat tak ada gambar
                          ATAU sementara gambar loading (konsisten antar komponen). */}
                      <UtensilsCrossed className="h-5 w-5 text-muted-foreground/40" />
                      {item.image_url && (
                        <Image
                          src={item.image_url}
                          alt={item.name}
                          width={56}
                          height={56}
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        {habis && (
                          <span className="text-[10px] text-red-400 border border-red-500/40 rounded px-1 shrink-0">
                            Sold out
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-primary tabular-nums shrink-0">
                      {formatIDR(item.price)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )
      )}
        </div>
      )}
    </div>
  );
}
