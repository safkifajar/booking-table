"use client";

import * as React from "react";
import Image from "next/image";
import { UtensilsCrossed, Search, SlidersHorizontal, Check } from "lucide-react";
import { cn, formatIDR } from "@/lib/utils";
import type { MenuCategoryTree } from "@/types/db";

/**
 * Daftar menu READ-ONLY (lihat saja, tanpa cart/pesan) — dipakai di tab Menu
 * halaman denah. Untuk pesan beneran ada MenuPicker di dalam session.
 * Item habis (is_available=false) ditandai redup + label. Ada search by nama.
 * Struktur 2 level: kategori utama → subkategori → item.
 */
export function MenuList({ menu }: { menu: MenuCategoryTree[] }) {
  const [query, setQuery] = React.useState("");
  // Filter kategori — "all" = semua. Hanya kategori yg punya item.
  const [category, setCategory] = React.useState("all");
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

  const hasItems = menu.some((c) =>
    c.subcategories.some((s) => s.items.length > 0)
  );
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

  // Opsi dropdown kategori: "All" + kategori UTAMA yg punya item (di subkategori).
  const categoryOptions = [
    { value: "all", label: "All categories" },
    ...menu
      .filter((c) => c.subcategories.some((s) => s.items.length > 0))
      .map((c) => ({ value: c.id, label: c.name })),
  ];

  // Filter: kategori utama terpilih (kalau bukan "all") + cari nama/deskripsi/tag
  // menu (case-insensitive), diterapkan per subkategori. Kategori/subkategori
  // tanpa hasil disembunyikan.
  const q = query.trim().toLowerCase();
  const filtered = menu
    .filter((cat) => category === "all" || cat.id === category)
    .map((cat) => ({
      ...cat,
      subcategories: cat.subcategories
        .map((sub) => ({
          ...sub,
          items: q
            ? sub.items.filter(
                (i) =>
                  i.name.toLowerCase().includes(q) ||
                  (i.description?.toLowerCase().includes(q) ?? false) ||
                  i.tags.some((t) => t.toLowerCase().includes(q))
              )
            : sub.items,
        }))
        .filter((sub) => sub.items.length > 0),
    }))
    .filter((cat) => cat.subcategories.length > 0);
  const anyMatch = filtered.length > 0;

  return (
    <div className="space-y-4">
      {/* Search + Filter kategori — style seragam dgn halaman Network. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu…"
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
        </div>
        {categoryOptions.length > 1 && (
          <div ref={filterRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition",
                category !== "all"
                  ? "border-primary bg-primary/15 text-primary font-medium"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
              )}
              aria-label="Filter by category"
              aria-haspopup="listbox"
              aria-expanded={filterOpen}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Filter</span>
              {category !== "all" && (
                <span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none">
                  1
                </span>
              )}
            </button>

            {filterOpen && (
              <div
                role="listbox"
                // overscroll-contain: putus scroll-chaining — scroll di dropdown
                // tak "tembus" menggerakkan daftar menu di belakangnya.
                className="absolute right-0 z-50 mt-1.5 min-w-44 max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1 shadow-2xl"
              >
                {categoryOptions.map((o) => {
                  const isSel = o.value === category;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      onClick={() => {
                        setCategory(o.value);
                        setFilterOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm text-left transition",
                        isSel
                          ? "bg-primary/15 text-primary"
                          : "text-foreground hover:bg-muted/60"
                      )}
                    >
                      <span className="truncate">{o.label}</span>
                      {isSel && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
        // Hanya list menu yg scroll (search box di atas tetap diam). Tinggi =
        // sisa layar dari bawah search s/d tepat di atas bottom nav (dvh utk
        // mobile). overscroll-contain cegah scroll bocor ke halaman saat mentok.
        <div className="space-y-6 max-h-[calc(100dvh-16rem)] overflow-y-auto overscroll-contain pr-0.5">
      {filtered.map((cat) => (
        <section key={cat.id} className="space-y-4">
          <h2 className="text-sm uppercase tracking-widest font-bold text-foreground mb-1">
            {cat.name}
          </h2>
          {cat.subcategories.map((sub) => (
            <div key={sub.id}>
              <h3 className="text-xs uppercase tracking-widest font-semibold text-foreground/80 mb-3">
                {sub.name}
              </h3>
              <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                {sub.items.map((item) => {
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
            </div>
          ))}
        </section>
      ))}
        </div>
      )}
    </div>
  );
}
