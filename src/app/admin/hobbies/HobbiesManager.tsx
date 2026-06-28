"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { addHobby, deleteHobby } from "@/lib/hobby-actions";
import { HOBBY_CATEGORY_OPTIONS, type HobbyGroup } from "@/lib/hobbies";
import { getActionErrorMessage } from "@/lib/utils";

export function HobbiesManager({ groups }: { groups: HobbyGroup[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState(HOBBY_CATEGORY_OPTIONS[0]);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const total = groups.reduce((s, g) => s + g.items.length, 0);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Nama hobi wajib diisi");
      return;
    }
    setAdding(true);
    try {
      await addHobby({ name: name.trim(), category });
      toast.success("Hobi ditambahkan");
      setName("");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal menambah hobi"));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string, hobbyName: string) {
    const ok = await confirm({
      title: "Hapus hobi?",
      description: `"${hobbyName}" akan dihapus dari pilihan. Customer yang sudah memilihnya tetap menyimpannya.`,
      confirmText: "Hapus",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(id);
    try {
      await deleteHobby(id);
      toast.success("Hobi dihapus");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus"));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
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
            className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </div>
        <div className="sm:w-56">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Kategori
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          >
            {HOBBY_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="gold" disabled={adding}>
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Tambah
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">{total} hobi total</p>

      {/* Daftar per kategori */}
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.category}>
            <h2 className="text-sm font-semibold mb-2">{g.category}</h2>
            <div className="flex flex-wrap gap-2">
              {g.items.map((h) => (
                <span
                  key={h.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-1.5 py-1 text-sm"
                >
                  {h.name}
                  <button
                    type="button"
                    onClick={() => handleDelete(h.id, h.name)}
                    disabled={deleting === h.id}
                    aria-label={`Hapus ${h.name}`}
                    className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition"
                  >
                    {deleting === h.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
