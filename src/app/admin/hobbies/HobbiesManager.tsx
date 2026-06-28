"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1 mb-4 w-fit">
        <TabBtn active={tab === "hobbies"} onClick={() => setTab("hobbies")}>
          Hobi &amp; Minat
          <span className="ml-1.5 text-xs opacity-70">{hobbiesList.length}</span>
        </TabBtn>
        <TabBtn active={tab === "categories"} onClick={() => setTab("categories")}>
          Kategori
          <span className="ml-1.5 text-xs opacity-70">{categories.length}</span>
        </TabBtn>
      </div>

      {tab === "hobbies" ? (
        <HobbiesTab hobbiesList={hobbiesList} categories={categories} />
      ) : (
        <CategoriesTab categories={categories} />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-1.5 rounded-md text-sm font-medium transition",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/* ---------- Tab Hobi (tabel) ---------- */
function HobbiesTab({
  hobbiesList,
  categories,
}: {
  hobbiesList: HobbyItem[];
  categories: HobbyCategory[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState(categories[0]?.name ?? "");
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editCat, setEditCat] = React.useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Nama hobi wajib diisi");
    if (!category) return toast.error("Pilih kategori dulu");
    setAdding(true);
    try {
      await addHobby({ name: name.trim(), category });
      toast.success("Hobi ditambahkan");
      setName("");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal menambah"));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(h: HobbyItem) {
    const ok = await confirm({
      title: "Hapus hobi?",
      description: `"${h.name}" dihapus dari pilihan. Customer yg sudah memilihnya tetap menyimpannya.`,
      confirmText: "Hapus",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(h.id);
    try {
      await deleteHobby(h.id);
      toast.success("Hobi dihapus");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) return toast.error("Nama wajib diisi");
    setBusy(id);
    try {
      await updateHobby({ id, name: editName.trim(), category: editCat });
      toast.success("Hobi diperbarui");
      setEditId(null);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Form tambah */}
      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row gap-2 sm:items-end"
      >
        <div className="flex-1">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Nama hobi
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: panjat tebing"
            maxLength={40}
            className={inputCls}
          />
        </div>
        <div className="sm:w-56">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Kategori
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputCls}
          >
            {categories.length === 0 && <option value="">— belum ada —</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="gold" disabled={adding}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Tambah
        </Button>
      </form>

      {/* Tabel */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-4 py-2.5">Nama</th>
              <th className="text-left px-4 py-2.5">Kategori</th>
              <th className="text-right px-4 py-2.5 w-24">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {hobbiesList.map((h) => (
              <tr key={h.id} className="border-b border-border/40 last:border-0">
                {editId === h.id ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={40}
                        className="w-full h-9 px-2 rounded-md bg-input border border-border text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={editCat}
                        onChange={(e) => setEditCat(e.target.value)}
                        className="w-full h-9 px-2 rounded-md bg-input border border-border text-sm"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleSaveEdit(h.id)}
                        disabled={busy === h.id}
                        className="p-1.5 rounded hover:bg-emerald-500/15 text-emerald-400"
                        aria-label="Simpan"
                      >
                        {busy === h.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                        aria-label="Batal"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 font-medium">{h.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {h.category}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setEditId(h.id);
                          setEditName(h.name);
                          setEditCat(h.category);
                        }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(h)}
                        disabled={busy === h.id}
                        className="p-1.5 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400"
                        aria-label="Hapus"
                      >
                        {busy === h.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {hobbiesList.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  Belum ada hobi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Tab Kategori ---------- */
function CategoriesTab({ categories }: { categories: HobbyCategory[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Nama kategori wajib diisi");
    setAdding(true);
    try {
      await addHobbyCategory({ name: name.trim() });
      toast.success("Kategori ditambahkan");
      setName("");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal menambah"));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(c: HobbyCategory) {
    const ok = await confirm({
      title: "Hapus kategori?",
      description: `Kategori "${c.name}" akan dihapus.`,
      confirmText: "Hapus",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(c.id);
    try {
      await deleteHobbyCategory(c.id);
      toast.success("Kategori dihapus");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) return toast.error("Nama wajib diisi");
    setBusy(id);
    try {
      await updateHobbyCategory({ id, name: editName.trim() });
      toast.success("Kategori diperbarui");
      setEditId(null);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-border bg-card p-4 flex gap-2 items-end"
      >
        <div className="flex-1">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Nama kategori
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Olahraga"
            maxLength={60}
            className={inputCls}
          />
        </div>
        <Button type="submit" variant="gold" disabled={adding}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Tambah
        </Button>
      </form>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-4 py-2.5">Nama Kategori</th>
              <th className="text-right px-4 py-2.5 w-24">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b border-border/40 last:border-0">
                {editId === c.id ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={60}
                        className="w-full h-9 px-2 rounded-md bg-input border border-border text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleSaveEdit(c.id)}
                        disabled={busy === c.id}
                        className="p-1.5 rounded hover:bg-emerald-500/15 text-emerald-400"
                        aria-label="Simpan"
                      >
                        {busy === c.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                        aria-label="Batal"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setEditId(c.id);
                          setEditName(c.name);
                        }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={busy === c.id}
                        className="p-1.5 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400"
                        aria-label="Hapus"
                      >
                        {busy === c.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {categories.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  Belum ada kategori.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60";
