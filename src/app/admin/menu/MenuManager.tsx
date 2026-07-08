"use client";

import * as React from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Edit2,
  Loader2,
  X,
  UtensilsCrossed,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Tag,
  Layers,
  Upload,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/ConfirmDialog";
import { Pagination } from "@/components/admin/Pagination";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleItemAvailability,
  type AdminMenuCategory,
  type AdminMenuItem,
} from "@/lib/menu-actions";
import {
  importCategories,
  importMenuItems,
} from "@/lib/menu-import-actions";
import { useRouter } from "next/navigation";
import { formatIDR, getActionErrorMessage, cn } from "@/lib/utils";

interface Props {
  barId: string;
  initialCategories: AdminMenuCategory[];
  initialItems: AdminMenuItem[];
}

type Tab = "items" | "subcategories" | "categories";

const ACCEPTED =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export function MenuManager({
  barId,
  initialCategories,
  initialItems,
}: Props) {
  const [tab, setTab] = React.useState<Tab>("items");
  const [categories, setCategories] = React.useState(initialCategories);
  const [items, setItems] = React.useState(initialItems);

  // Sync state dengan props saat parent re-fetch (router.refresh setelah import)
  React.useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);
  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);
  const [filterCategoryId, setFilterCategoryId] = React.useState<string | "all">(
    "all"
  );
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [editingItem, setEditingItem] = React.useState<AdminMenuItem | null>(
    null
  );
  const [creatingItem, setCreatingItem] = React.useState(false);
  const [editingCategory, setEditingCategory] =
    React.useState<AdminMenuCategory | null>(null);
  const [creatingCategory, setCreatingCategory] = React.useState(false);
  // Saat buat kategori: "main" (utama) atau "sub" (paksa punya induk).
  const [creatingCategoryVariant, setCreatingCategoryVariant] =
    React.useState<"main" | "sub">("main");
  const [importingMode, setImportingMode] = React.useState<
    "categories" | "items" | null
  >(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const confirm = useConfirm();
  const router = useRouter();

  const filteredItems = React.useMemo(() => {
    if (filterCategoryId === "all") return items;
    return items.filter((i) => i.categoryId === filterCategoryId);
  }, [items, filterCategoryId]);

  // Reset ke page 0 kalau filter / pageSize ganti (atau items berkurang)
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedItems = React.useMemo(
    () => filteredItems.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filteredItems, safePage, pageSize]
  );

  React.useEffect(() => {
    setPage(0);
  }, [filterCategoryId, pageSize]);

  // Tabs
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border w-fit">
        <TabButton
          icon={<UtensilsCrossed className="h-3.5 w-3.5" />}
          label="Items"
          active={tab === "items"}
          onClick={() => setTab("items")}
          badge={items.length}
        />
        <TabButton
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Sub-Categories"
          active={tab === "subcategories"}
          onClick={() => setTab("subcategories")}
          badge={categories.filter((c) => c.parent_id != null).length}
        />
        <TabButton
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Categories"
          active={tab === "categories"}
          onClick={() => setTab("categories")}
          badge={categories.filter((c) => c.parent_id == null).length}
        />
      </div>

      {tab === "items" ? (
        <ItemsTab
          items={pagedItems}
          filteredCount={filteredItems.length}
          allItemCount={items.length}
          categories={categories}
          filterCategoryId={filterCategoryId}
          setFilterCategoryId={setFilterCategoryId}
          page={safePage}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={(p) => {
            setPage(p);
            if (typeof window !== "undefined") {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          onPageSizeChange={setPageSize}
          onCreate={() => setCreatingItem(true)}
          onImport={() => setImportingMode("items")}
          onEdit={setEditingItem}
          onDelete={async (item) => {
            const ok = await confirm({
              title: "Delete this item?",
              description: `"${item.name}" will be permanently deleted.`,
              confirmText: "Delete",
              cancelText: "Cancel",
              variant: "danger",
            });
            if (!ok) return;
            setDeletingId(item.id);
            try {
              await deleteMenuItem(item.id);
              setItems((arr) => arr.filter((i) => i.id !== item.id));
              toast.success("Item deleted");
            } catch (err) {
              toast.error(getActionErrorMessage(err, "Failed to delete item"));
            } finally {
              setDeletingId(null);
            }
          }}
          deletingId={deletingId}
          onToggleAvail={async (item) => {
            const next = !item.isAvailable;
            // Optimistic update
            setItems((arr) =>
              arr.map((i) =>
                i.id === item.id ? { ...i, isAvailable: next } : i
              )
            );
            try {
              await toggleItemAvailability(item.id, next);
            } catch (err) {
              // Rollback
              setItems((arr) =>
                arr.map((i) =>
                  i.id === item.id ? { ...i, isAvailable: item.isAvailable } : i
                )
              );
              toast.error(getActionErrorMessage(err, "Failed to update"));
            }
          }}
        />
      ) : tab === "subcategories" || tab === "categories" ? (
        <CategoriesTab
          variant={tab === "subcategories" ? "sub" : "main"}
          categories={categories}
          onCreate={() => {
            setCreatingCategoryVariant(
              tab === "subcategories" ? "sub" : "main"
            );
            setCreatingCategory(true);
          }}
          onImport={() => setImportingMode("categories")}
          onEdit={setEditingCategory}
          onDelete={async (cat) => {
            const isSub = cat.parent_id != null;
            const ok = await confirm({
              title: `Delete this ${isSub ? "sub-category" : "category"}?`,
              description: isSub
                ? `"${cat.name}" will be deleted. Move its items out first.`
                : `"${cat.name}" and its sub-categories will be deleted. Move items out first.`,
              confirmText: "Delete",
              cancelText: "Cancel",
              variant: "danger",
            });
            if (!ok) return;
            setDeletingId(cat.id);
            try {
              await deleteCategory(cat.id);
              setCategories((arr) => arr.filter((c) => c.id !== cat.id));
              toast.success(
                isSub ? "Sub-category deleted" : "Category deleted"
              );
            } catch (err) {
              toast.error(getActionErrorMessage(err, "Failed to delete category"));
            } finally {
              setDeletingId(null);
            }
          }}
          deletingId={deletingId}
        />
      ) : null}

      {(creatingItem || editingItem) && (
        <ItemFormModal
          mode={editingItem ? "edit" : "create"}
          initial={editingItem}
          categories={categories}
          onClose={() => {
            setCreatingItem(false);
            setEditingItem(null);
          }}
          onSaved={(updated) => {
            if (editingItem) {
              setItems((arr) =>
                arr.map((i) => (i.id === updated.id ? updated : i))
              );
            } else {
              setItems((arr) => [updated, ...arr]);
            }
            setCreatingItem(false);
            setEditingItem(null);
          }}
        />
      )}

      {(creatingCategory || editingCategory) && (
        <CategoryFormModal
          mode={editingCategory ? "edit" : "create"}
          initial={editingCategory}
          categories={categories}
          barId={barId}
          createVariant={creatingCategoryVariant}
          onClose={() => {
            setCreatingCategory(false);
            setEditingCategory(null);
          }}
          onSaved={(updated) => {
            if (editingCategory) {
              setCategories((arr) =>
                arr.map((c) => (c.id === updated.id ? updated : c))
              );
            } else {
              setCategories((arr) => [...arr, updated]);
            }
            setCreatingCategory(false);
            setEditingCategory(null);
          }}
        />
      )}

      {importingMode && (
        <ImportModal
          mode={importingMode}
          barId={barId}
          onClose={() => setImportingMode(null)}
          onSuccess={() => {
            setImportingMode(null);
            // Refresh dari server supaya state sync (data baru dari import)
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// ITEMS TAB
// ============================================================

function ItemsTab({
  items,
  filteredCount,
  allItemCount,
  categories,
  filterCategoryId,
  setFilterCategoryId,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  onCreate,
  onImport,
  onEdit,
  onDelete,
  deletingId,
  onToggleAvail,
}: {
  items: AdminMenuItem[];
  filteredCount: number;
  allItemCount: number;
  categories: AdminMenuCategory[];
  filterCategoryId: string | "all";
  setFilterCategoryId: (id: string | "all") => void;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (size: number) => void;
  onCreate: () => void;
  onImport: () => void;
  onEdit: (item: AdminMenuItem) => void;
  onDelete: (item: AdminMenuItem) => void | Promise<void>;
  deletingId: string | null;
  onToggleAvail: (item: AdminMenuItem) => void | Promise<void>;
}) {
  const startIndex = page * pageSize;
  const endIndex = Math.min(startIndex + items.length, filteredCount);

  // Label kategori item: "Kategori Utama - Sub Kategori". Item menempel di
  // sub-kategori, jadi induknya dicari lewat parent_id.
  const catById = React.useMemo(() => {
    const m = new Map<string, AdminMenuCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);
  const categoryLabel = React.useCallback(
    (item: AdminMenuItem): string => {
      const cat = catById.get(item.categoryId);
      if (!cat) return item.categoryName;
      const parent = cat.parent_id ? catById.get(cat.parent_id) : null;
      return parent ? `${parent.name} - ${cat.name}` : cat.name;
    },
    [catById]
  );

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={filterCategoryId}
            onChange={(v) => setFilterCategoryId(v as string | "all")}
            options={[
              { value: "all", label: `All categories (${allItemCount})` },
              // Item menempel di sub-kategori → filter pakai sub-kat, label
              // "Utama - Sub". Kategori tanpa induk (langsung punya item) tetap.
              ...categories
                .filter((c) => c.parent_id != null || c.itemCount > 0)
                .map((c) => {
                  const parent = c.parent_id
                    ? categories.find((p) => p.id === c.parent_id)
                    : null;
                  return {
                    value: c.id,
                    label: `${parent ? `${parent.name} - ` : ""}${c.name} (${c.itemCount})`,
                  };
                }),
            ]}
            ariaLabel="Filter category"
          />
          <div className="text-xs text-muted-foreground">
            {filteredCount === 0
              ? "0 items"
              : `${startIndex + 1}–${endIndex} of ${filteredCount} items`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onImport}
            disabled={categories.length === 0}
            title={
              categories.length === 0
                ? "Create a category before importing"
                : "Import items from Excel/CSV/ZIP"
            }
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Import</span>
          </Button>
          <Button
            variant="gold"
            size="sm"
            onClick={onCreate}
            disabled={categories.length === 0}
            title={
              categories.length === 0
                ? "Create a category before adding an item"
                : "Add new item"
            }
          >
            <Plus className="h-3.5 w-3.5" />
            New Item
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <UtensilsCrossed className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">
            {allItemCount === 0
              ? "No menu items yet"
              : "No items in this category"}
          </p>
          <p className="text-xs text-muted-foreground">
            {categories.length === 0
              ? "Create a category to get started."
              : "Click 'New Item' to add one."}
          </p>
        </Card>
      ) : (
        <>
          {/* Desktop: table */}
          <Card className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Item</th>
                    <th className="text-left p-3">Category</th>
                    <th className="text-right p-3">Price</th>
                    <th className="text-center p-3">Status</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-border hover:bg-muted/20 transition"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <ItemThumb
                            imageUrl={item.imageUrl}
                            alt={item.name}
                            size={40}
                          />
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {item.name}
                            </div>
                            {item.description && (
                              <div className="text-xs text-muted-foreground truncate max-w-xs">
                                {item.description}
                              </div>
                            )}
                            {item.tags.length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-1">
                                {item.tags.slice(0, 3).map((t) => (
                                  <Badge
                                    key={t}
                                    variant="secondary"
                                    className="text-[9px] px-1.5"
                                  >
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {categoryLabel(item)}
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums">
                        {formatIDR(item.price)}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => onToggleAvail(item)}
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition",
                            item.isAvailable
                              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                              : "bg-muted text-muted-foreground hover:bg-muted/70"
                          )}
                          title="Click to toggle"
                        >
                          {item.isAvailable ? (
                            <>
                              <Eye className="h-2.5 w-2.5" />
                              Available
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-2.5 w-2.5" />
                              Sold out
                            </>
                          )}
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(item)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete(item)}
                            disabled={deletingId === item.id}
                            className="text-red-400 hover:text-red-300"
                          >
                            {deletingId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile: card list */}
          <div className="md:hidden space-y-2">
            {items.map((item) => (
              <Card key={item.id} className="p-3">
                <div className="flex gap-3">
                  <ItemThumb
                    imageUrl={item.imageUrl}
                    alt={item.name}
                    size={56}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{item.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {categoryLabel(item)}
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums shrink-0">
                        {formatIDR(item.price)}
                      </div>
                    </div>
                    {item.description && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {item.description}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => onToggleAvail(item)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium",
                          item.isAvailable
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {item.isAvailable ? (
                          <>
                            <Eye className="h-2.5 w-2.5" />
                            Available
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-2.5 w-2.5" />
                            Sold out
                          </>
                        )}
                      </button>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(item)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(item)}
                          disabled={deletingId === item.id}
                          className="text-red-400"
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Page size + pagination control */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Per page:</span>
              <Select
                value={String(pageSize)}
                onChange={(v) => onPageSizeChange(Number(v))}
                options={[
                  { value: "10", label: "10" },
                  { value: "25", label: "25" },
                  { value: "50", label: "50" },
                  { value: "100", label: "100" },
                ]}
                ariaLabel="Per page"
              />
            </label>
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={onPageChange}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

function ItemThumb({
  imageUrl,
  alt,
  size,
}: {
  imageUrl: string | null;
  alt: string;
  size: number;
}) {
  if (!imageUrl) {
    return (
      <div
        className="rounded-md bg-muted/40 border border-border flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    <div
      className="relative rounded-md overflow-hidden bg-muted shrink-0"
      style={{ width: size, height: size }}
    >
      <Image src={imageUrl} alt={alt} fill className="object-cover" sizes={`${size}px`} />
    </div>
  );
}

// ============================================================
// CATEGORIES TAB
// ============================================================

function CategoriesTab({
  variant,
  categories,
  onCreate,
  onImport,
  onEdit,
  onDelete,
  deletingId,
}: {
  /** "main" = kategori utama saja; "sub" = sub-kategori saja. */
  variant: "main" | "sub";
  categories: AdminMenuCategory[];
  onCreate: () => void;
  onImport: () => void;
  onEdit: (c: AdminMenuCategory) => void;
  onDelete: (c: AdminMenuCategory) => void | Promise<void>;
  deletingId: string | null;
}) {
  const isSub = variant === "sub";
  const nameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  // Daftar kategori utama utk filter di tab Sub-Categories.
  const mainCategories = React.useMemo(
    () => categories.filter((c) => c.parent_id == null),
    [categories]
  );

  // Filter kategori utama (khusus sub) + pagination (pola sama dgn Items).
  const [filterParentId, setFilterParentId] = React.useState<string | "all">(
    "all"
  );
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  // Semua baris (sudah difilter varian + filter induk), diurutkan.
  const allRows = React.useMemo(() => {
    if (!isSub) return categories.filter((c) => c.parent_id == null);
    return categories
      .filter((c) => c.parent_id != null)
      .filter((c) => filterParentId === "all" || c.parent_id === filterParentId)
      .sort((a, b) => {
        const pa = nameById.get(a.parent_id!) ?? "";
        const pb = nameById.get(b.parent_id!) ?? "";
        return pa.localeCompare(pb) || a.name.localeCompare(b.name);
      });
  }, [categories, isSub, nameById, filterParentId]);

  // Reset ke page 0 saat filter/pageSize berubah.
  React.useEffect(() => {
    setPage(0);
  }, [filterParentId, pageSize]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const rows = React.useMemo(
    () => allRows.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [allRows, safePage, pageSize]
  );
  const startIndex = safePage * pageSize;
  const endIndex = Math.min(startIndex + rows.length, allRows.length);

  const label = isSub ? "Sub-Category" : "Category";
  const noun = isSub ? "sub-categories" : "categories";
  const emptyHint = isSub
    ? "Create a sub-category (e.g. Rice) under a main category."
    : "Create a main category (e.g. Main Course) to start.";

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter by kategori utama — khusus tab Sub-Categories. */}
          {isSub && mainCategories.length > 0 && (
            <Select
              value={filterParentId}
              onChange={(v) => setFilterParentId(v as string | "all")}
              options={[
                {
                  value: "all",
                  label: `All categories (${
                    categories.filter((c) => c.parent_id != null).length
                  })`,
                },
                ...mainCategories.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${
                    categories.filter((s) => s.parent_id === c.id).length
                  })`,
                })),
              ]}
              ariaLabel="Filter by main category"
            />
          )}
          <div className="text-xs text-muted-foreground">
            {allRows.length === 0
              ? `0 ${noun}`
              : `${startIndex + 1}–${endIndex} of ${allRows.length} ${noun}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isSub && (
            <Button variant="outline" size="sm" onClick={onImport}>
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Import</span>
            </Button>
          )}
          <Button variant="gold" size="sm" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            New {label}
          </Button>
        </div>
      </div>

      {allRows.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Layers className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">
            {isSub && filterParentId !== "all"
              ? "No sub-categories in this category"
              : `No ${noun} yet`}
          </p>
          <p className="text-xs text-muted-foreground">{emptyHint}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Name</th>
                {isSub && <th className="text-left p-3">Main category</th>}
                <th className="text-center p-3">Items</th>
                <th className="text-center p-3">Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-border hover:bg-muted/20 transition"
                >
                  <td className="p-3 font-medium">{c.name}</td>
                  {isSub && (
                    <td className="p-3 text-muted-foreground">
                      {c.parent_id ? (
                        nameById.get(c.parent_id) ?? "—"
                      ) : (
                        <span className="text-red-400">no parent</span>
                      )}
                    </td>
                  )}
                  <td className="p-3 text-center">{c.itemCount}</td>
                  <td className="p-3 text-center">
                    {c.isActive ? (
                      <Badge
                        variant="default"
                        className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]"
                      >
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(c)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(c)}
                        className="text-red-400 hover:text-red-300"
                        disabled={c.itemCount > 0 || deletingId === c.id}
                        title={
                          c.itemCount > 0
                            ? "Move items out before deleting"
                            : `Delete ${label.toLowerCase()}`
                        }
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Footer pagination — pola sama dgn tab Items. */}
      {allRows.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Per page
            <Select
              value={String(pageSize)}
              onChange={(v) => setPageSize(Number(v))}
              options={[
                { value: "10", label: "10" },
                { value: "25", label: "25" },
                { value: "50", label: "50" },
                { value: "100", label: "100" },
              ]}
              ariaLabel="Per page"
            />
          </label>
          {totalPages > 1 && (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              onChange={(p) => {
                setPage(p);
                if (typeof window !== "undefined") {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

// ============================================================
// ITEM FORM MODAL
// ============================================================

function ItemFormModal({
  mode,
  initial,
  categories,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: AdminMenuItem | null;
  categories: AdminMenuCategory[];
  onClose: () => void;
  onSaved: (item: AdminMenuItem) => void;
}) {
  // Item hanya boleh menempel di sub-kategori (leaf). Label pakai
  // "Induk › Sub" biar jelas.
  const nameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const subCategoryOptions = React.useMemo(
    () =>
      categories
        .filter((c) => c.parent_id != null)
        .map((c) => ({
          value: c.id,
          label: c.parent_id
            ? `${nameById.get(c.parent_id) ?? "?"} › ${c.name}`
            : c.name,
        })),
    [categories, nameById]
  );
  const [categoryId, setCategoryId] = React.useState(
    initial?.categoryId ?? subCategoryOptions[0]?.value ?? ""
  );
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? ""
  );
  const [price, setPrice] = React.useState(initial?.price ?? 0);
  const [tagsText, setTagsText] = React.useState(initial?.tags.join(", ") ?? "");
  const [isAvailable, setIsAvailable] = React.useState(
    initial?.isAvailable ?? true
  );
  const [prepMinutes, setPrepMinutes] = React.useState(
    initial?.prepMinutes ?? 5
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(
    initial?.imageUrl ?? null
  );
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !categoryId || submitting) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("categoryId", categoryId);
      formData.set("name", name.trim());
      formData.set("description", description.trim());
      formData.set("price", String(price));
      formData.set("tags", tagsText);
      formData.set("isAvailable", String(isAvailable));
      formData.set("prepMinutes", String(prepMinutes));
      if (file) formData.set("file", file);

      let savedId: string;
      if (mode === "create") {
        formData.set("file", file ?? new Blob());
        const result = await createMenuItem(formData);
        savedId = result.id;
      } else {
        formData.set("id", initial!.id);
        await updateMenuItem(formData);
        savedId = initial!.id;
      }

      const category = categories.find((c) => c.id === categoryId);
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      onSaved({
        id: savedId,
        categoryId,
        categoryName: category?.name ?? "",
        name: name.trim(),
        description: description.trim() || null,
        price,
        imageUrl: file ? preview : initial?.imageUrl ?? null,
        tags,
        isAvailable,
        prepMinutes,
        sortOrder: initial?.sortOrder ?? 0,
      });
      toast.success(mode === "create" ? "Item added" : "Item saved");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title={mode === "create" ? "New Item" : "Edit Item"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        {/* Image upload */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Photo (optional, 1:1)
          </label>
          <div className="flex items-center gap-3">
            <div className="relative h-24 w-24 rounded-md bg-muted/40 border border-border overflow-hidden shrink-0">
              {preview ? (
                <Image
                  src={preview}
                  alt="preview"
                  fill
                  className="object-cover"
                  sizes="96px"
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <input
                type="file"
                accept={ACCEPTED}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-xs file:font-medium hover:file:bg-primary/90 file:cursor-pointer"
              />
              <p className="text-[10px] text-muted-foreground">
                JPG/PNG/WebP/HEIC max 10MB. Will be resized to 800×800 webp.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Category
          </label>
          <Select
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: "", label: "— Select category —" },
              ...subCategoryOptions,
            ]}
            placeholder="— Select category —"
            ariaLabel="Category"
          />
          {subCategoryOptions.length === 0 && (
            <p className="text-[10px] text-amber-400 mt-1">
              Create a sub-category first.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Item name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. SOHO Sunset"
            maxLength={80}
            className="w-full h-10 px-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
            required
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tequila, passionfruit, lime, hint of chili"
            maxLength={300}
            rows={2}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm resize-y focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Price (Rp)
          </label>
          <MoneyInput value={price} onChange={setPrice} />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Tags (comma separated)
          </label>
          <div className="relative">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="signature, spicy, cold"
              className="w-full h-10 pl-9 pr-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isAvailable}
            onChange={(e) => setIsAvailable(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span>Available (shown in customer menu)</span>
        </label>

        <div className="sticky bottom-0 -mx-4 -mb-4 p-4 bg-background border-t border-border">
          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={!name.trim() || !categoryId || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : mode === "create" ? (
              "Add Item"
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ============================================================
// CATEGORY FORM MODAL
// ============================================================

function CategoryFormModal({
  mode,
  initial,
  categories,
  barId,
  createVariant = "main",
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: AdminMenuCategory | null;
  categories: AdminMenuCategory[];
  barId: string;
  /** Saat create: "sub" → wajib pilih induk; "main" → tanpa induk. */
  createVariant?: "main" | "sub";
  onClose: () => void;
  onSaved: (cat: AdminMenuCategory) => void;
}) {
  // Saat edit, "sub" ditentukan dari data existing. Saat create, dari variant.
  const isSubForm =
    mode === "edit" ? initial?.parent_id != null : createVariant === "sub";
  const [name, setName] = React.useState(initial?.name ?? "");
  const [parentId, setParentId] = React.useState<string>(
    initial?.parent_id ?? ""
  );
  const [isActive, setIsActive] = React.useState(initial?.isActive ?? true);
  const [submitting, setSubmitting] = React.useState(false);

  // Kandidat induk: kategori utama (parent_id null) selain diri sendiri.
  const parentOptions = React.useMemo(
    () =>
      categories.filter(
        (c) => c.parent_id == null && c.id !== initial?.id
      ),
    [categories, initial?.id]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    // Sub-kategori wajib punya induk.
    if (isSubForm && !parentId) {
      toast.error("Pick a main category for this sub-category");
      return;
    }

    setSubmitting(true);
    try {
      const parent = parentId || null;
      const payload = {
        barId,
        name: name.trim(),
        parentId: parent,
        isActive,
      };
      let savedId: string;
      let savedSlug: string;
      if (mode === "create") {
        const result = await createCategory(payload);
        savedId = result.id;
        savedSlug = result.slug;
      } else {
        const result = await updateCategory({ ...payload, id: initial!.id });
        savedId = initial!.id;
        savedSlug = result.slug ?? initial!.slug;
      }
      onSaved({
        id: savedId,
        name: name.trim(),
        slug: savedSlug,
        parent_id: parent,
        sortOrder: initial?.sortOrder ?? 0,
        isActive,
        itemCount: initial?.itemCount ?? 0,
      });
      toast.success(
        `${titleNoun} ${mode === "create" ? "added" : "saved"}`
      );
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
      setSubmitting(false);
    }
  }

  const titleNoun = isSubForm ? "Sub-Category" : "Category";
  return (
    <ModalShell
      title={mode === "create" ? `New ${titleNoun}` : `Edit ${titleNoun}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            {titleNoun} name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isSubForm ? "e.g. Rice" : "e.g. Main Course"}
            maxLength={60}
            autoFocus
            className="w-full h-10 px-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
            required
          />
        </div>

        {/* Induk hanya relevan utk sub-kategori. Kategori utama tak punya induk. */}
        {isSubForm && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              Main category
            </label>
            <Select
              value={parentId}
              onChange={setParentId}
              options={parentOptions.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              placeholder="Select a main category…"
              ariaLabel="Main category"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {parentOptions.length === 0
                ? "Create a main category first."
                : "This sub-category will live under the chosen main category."}
            </p>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span>Active (shown in customer menu)</span>
        </label>

        <div className="sticky bottom-0 -mx-4 -mb-4 p-4 bg-background border-t border-border">
          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={!name.trim() || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : mode === "create" ? (
              "Add Category"
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ============================================================
// SHARED
// ============================================================

// ============================================================
// IMPORT MODAL
// ============================================================

function ImportModal({
  mode,
  barId,
  onClose,
  onSuccess,
}: {
  mode: "categories" | "items";
  barId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    inserted: number;
    imagesUploaded?: number;
  } | null>(null);

  const isItems = mode === "items";
  const accept = isItems
    ? ".csv,.xlsx,.xls,.zip,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
    : ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function downloadTemplate() {
    const csv = isItems
      ? "category_name,subcategory_name,name,description,price,tags,is_available,image\nMain Course,Rice,Hikiniku Rice,\"Hamburg Beef, Onsen Egg, Miso Soup\",83000,\"main,beef\",true,\nMain Course,Rice,Saikoro Omelette Curry Rice,Saikoro Beef + Curry Sauce,63000,curry,true,saikoro.jpg\n"
      : "name,is_active\nCoffee,true\nCocktail,true\nFood,true\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isItems ? "template-items.csv" : "template-categories.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("barId", barId);
      formData.set("file", file);

      if (isItems) {
        const r = await importMenuItems(formData);
        setResult(r);
        toast.success(
          `${r.inserted} items imported${
            r.imagesUploaded > 0 ? ` (+${r.imagesUploaded} photos)` : ""
          }`
        );
      } else {
        const r = await importCategories(formData);
        setResult(r);
        toast.success(`${r.inserted} categories imported`);
      }
      setSubmitting(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to import"));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title={isItems ? "Import Items" : "Import Categories"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        {result ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <div className="text-2xl mb-2">✓</div>
            <p className="text-sm font-medium text-emerald-400">
              {result.inserted} {isItems ? "items" : "categories"} imported
            </p>
            {result.imagesUploaded !== undefined &&
              result.imagesUploaded > 0 && (
                <p className="text-xs text-emerald-400/70 mt-1">
                  + {result.imagesUploaded} photos uploaded
                </p>
              )}
          </div>
        ) : (
          <>
            {/* Instructions */}
            <div className="rounded-md bg-muted/40 border border-border p-3 text-xs space-y-2">
              <p className="font-medium">File format:</p>
              {isItems ? (
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>
                    <strong>CSV/Excel</strong>: columns{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      category_name, subcategory_name, name, description, price,
                      tags, is_available, image
                    </code>
                  </li>
                  <li>
                    <strong>category_name</strong> = main category (e.g. Main
                    Course), <strong>subcategory_name</strong> = sub-category
                    (e.g. Rice) — <strong>required</strong> for every item.
                  </li>
                  <li>
                    Main categories & sub-categories are{" "}
                    <strong>auto-created</strong> if they don&apos;t exist yet
                    (matched by name, case insensitive).
                  </li>
                  <li>
                    <strong>ZIP</strong>: to include photos. A ZIP containing
                    CSV/Excel + photo files. Fill the{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      image
                    </code>{" "}
                    column with the file name (e.g. <code>americano.jpg</code>).
                  </li>
                  <li>Max 1000 items per import.</li>
                </ul>
              ) : (
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>
                    Columns:{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      name, is_active
                    </code>
                  </li>
                  <li>Slug auto-generated from the name.</li>
                  <li>Max 200 categories per import.</li>
                </ul>
              )}
            </div>

            {/* Download template */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              className="w-full"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV Template
            </Button>

            {/* File picker */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Select file
              </label>
              <input
                type="file"
                accept={accept}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs file:mr-2 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-xs file:font-medium hover:file:bg-primary/90 file:cursor-pointer"
              />
              {file && (
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate flex-1">{file.name}</span>
                  <span className="shrink-0">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                {isItems
                  ? ".csv / .xlsx / .zip — max 100MB"
                  : ".csv / .xlsx — max 5MB"}
              </p>
            </div>
          </>
        )}

        <div className="sticky bottom-0 -mx-4 -mb-4 p-4 bg-background border-t border-border">
          {result ? (
            <Button
              type="button"
              variant="gold"
              size="lg"
              className="w-full"
              onClick={onSuccess}
            >
              Done
            </Button>
          ) : (
            <Button
              type="submit"
              variant="gold"
              size="lg"
              className="w-full"
              disabled={!file || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Start Import
                </>
              )}
            </Button>
          )}
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Kunci scroll background selama modal (import/tambah/ubah) terbuka.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// MoneyInput — Indonesian-formatted number input (reuse pattern)
function MoneyInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = React.useState(formatNumber(value));
  React.useEffect(() => {
    setText(formatNumber(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digitsOnly = e.target.value.replace(/\D/g, "");
    const num = digitsOnly === "" ? 0 : parseInt(digitsOnly, 10);
    setText(digitsOnly === "" ? "" : formatNumber(num));
    onChange(num);
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        Rp
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={handleChange}
        className="w-full h-10 pl-8 pr-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
      />
    </div>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return new Intl.NumberFormat("id-ID").format(n);
}
