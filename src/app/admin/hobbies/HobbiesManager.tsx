"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  Edit2,
  X,
  Search,
  Sparkles,
  Layers,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/admin/Pagination";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  addHobby,
  deleteHobby,
  updateHobby,
  addHobbyCategory,
  deleteHobbyCategory,
  updateHobbyCategory,
} from "@/lib/hobby-actions";
import type { HobbyItem, HobbyCategory } from "@/lib/hobbies";
import { cn, getActionErrorMessage } from "@/lib/utils";

type Tab = "hobbies" | "categories";

export function HobbiesManager({
  hobbiesList,
  categories,
}: {
  hobbiesList: HobbyItem[];
  categories: HobbyCategory[];
}) {
  const [tab, setTab] = React.useState<Tab>("hobbies");

  return (
    <div>
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border w-fit mb-4">
        <TabButton
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Hobi & Minat"
          active={tab === "hobbies"}
          onClick={() => setTab("hobbies")}
          badge={hobbiesList.length}
        />
        <TabButton
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Kategori"
          active={tab === "categories"}
          onClick={() => setTab("categories")}
          badge={categories.length}
        />
      </div>

      {tab === "hobbies" ? (
        <HobbiesTab hobbiesList={hobbiesList} categories={categories} />
      ) : (
        <CategoriesTab categories={categories} />
      )}
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
            active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/* ---------- Tab Hobi ---------- */
function HobbiesTab({
  hobbiesList,
  categories,
}: {
  hobbiesList: HobbyItem[];
  categories: HobbyCategory[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [formMode, setFormMode] = React.useState<
    { mode: "create" } | { mode: "edit"; item: HobbyItem } | null
  >(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? hobbiesList.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          h.category.toLowerCase().includes(q)
      )
    : hobbiesList;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  async function handleDelete(h: HobbyItem) {
    const ok = await confirm({
      title: "Hapus hobi?",
      description: `"${h.name}" dihapus dari pilihan. Customer yg sudah memilihnya tetap menyimpannya.`,
      confirmText: "Hapus",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(h.id);
    try {
      await deleteHobby(h.id);
      toast.success("Hobi dihapus");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Cari hobi / kategori…"
            className="w-full h-10 pl-8 pr-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <Button variant="gold" size="sm" onClick={() => setFormMode({ mode: "create" })}>
          <Plus className="h-4 w-4" /> Tambah Hobi
        </Button>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-4 py-2.5">Nama</th>
              <th className="text-left px-4 py-2.5">Kategori</th>
              <th className="text-right px-4 py-2.5 w-24">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((h) => (
              <tr key={h.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{h.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{h.category}</td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFormMode({ mode: "edit", item: h })}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(h)}
                      disabled={deletingId === h.id}
                      className="text-red-400 hover:text-red-300"
                    >
                      {deletingId === h.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  {q ? "Tidak ada hobi yang cocok." : "Belum ada hobi."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <PaginationBar
        page={safePage}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(0);
        }}
      />

      {formMode && (
        <HobbyFormModal
          mode={formMode.mode}
          initial={formMode.mode === "edit" ? formMode.item : null}
          categories={categories}
          onClose={() => setFormMode(null)}
          onSaved={() => {
            setFormMode(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Tab Kategori ---------- */
function CategoriesTab({ categories }: { categories: HobbyCategory[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [formMode, setFormMode] = React.useState<
    { mode: "create" } | { mode: "edit"; cat: HobbyCategory } | null
  >(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? categories.filter((c) => c.name.toLowerCase().includes(q))
    : categories;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  async function handleDelete(c: HobbyCategory) {
    const ok = await confirm({
      title: "Hapus kategori?",
      description: `Kategori "${c.name}" akan dihapus.`,
      confirmText: "Hapus",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(c.id);
    try {
      await deleteHobbyCategory(c.id);
      toast.success("Kategori dihapus");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Cari kategori…"
            className="w-full h-10 pl-8 pr-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <Button variant="gold" size="sm" onClick={() => setFormMode({ mode: "create" })}>
          <Plus className="h-4 w-4" /> Tambah Kategori
        </Button>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-4 py-2.5">Nama Kategori</th>
              <th className="text-right px-4 py-2.5 w-24">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c) => (
              <tr key={c.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFormMode({ mode: "edit", cat: c })}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(c)}
                      disabled={deletingId === c.id}
                      className="text-red-400 hover:text-red-300"
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                  {q ? "Tidak ada kategori yang cocok." : "Belum ada kategori."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <PaginationBar
        page={safePage}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(0);
        }}
      />

      {formMode && (
        <CategoryFormModal
          mode={formMode.mode}
          initial={formMode.mode === "edit" ? formMode.cat : null}
          onClose={() => setFormMode(null)}
          onSaved={() => {
            setFormMode(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Form Modals ---------- */
function HobbyFormModal({
  mode,
  initial,
  categories,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: HobbyItem | null;
  categories: HobbyCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [category, setCategory] = React.useState(
    initial?.category ?? categories[0]?.name ?? ""
  );
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    if (!category) {
      toast.error("Pilih kategori dulu");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "create") {
        await addHobby({ name: name.trim(), category });
      } else {
        await updateHobby({ id: initial!.id, name: name.trim(), category });
      }
      toast.success(mode === "create" ? "Hobi ditambahkan" : "Hobi disimpan");
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title={mode === "create" ? "Hobi Baru" : "Edit Hobi"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Nama hobi
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: panjat tebing"
            maxLength={40}
            autoFocus
            required
            className="w-full h-10 px-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Kategori
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-10 px-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
          >
            {categories.length === 0 && <option value="">— belum ada —</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
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
                <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...
              </>
            ) : mode === "create" ? (
              "Tambah Hobi"
            ) : (
              "Simpan Perubahan"
            )}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function CategoryFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: HobbyCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (mode === "create") {
        await addHobbyCategory({ name: name.trim() });
      } else {
        await updateHobbyCategory({ id: initial!.id, name: name.trim() });
      }
      toast.success(mode === "create" ? "Kategori ditambahkan" : "Kategori disimpan");
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title={mode === "create" ? "Kategori Baru" : "Edit Kategori"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Nama kategori
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Olahraga"
            maxLength={60}
            autoFocus
            required
            className="w-full h-10 px-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
          />
        </div>
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
                <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...
              </>
            ) : mode === "create" ? (
              "Tambah Kategori"
            ) : (
              "Simpan Perubahan"
            )}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ---------- Shared ---------- */
function PaginationBar({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Per halaman:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-8 px-2 rounded-md bg-input border border-border text-xs focus:outline-none focus:border-primary"
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />
      )}
    </div>
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
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
