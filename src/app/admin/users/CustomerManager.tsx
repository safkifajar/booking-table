"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  Search,
  UserPlus,
  Pencil,
  Trash2,
  Download,
  Loader2,
  Star,
} from "lucide-react";
import { Pagination } from "@/components/admin/Pagination";
import { initials, getActionErrorMessage, cn } from "@/lib/utils";
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type AdminCustomerRow,
} from "@/lib/customer-actions";

interface Props {
  initialRows: AdminCustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
}

type EditTarget =
  | { mode: "create" }
  | { mode: "edit"; row: AdminCustomerRow }
  | null;

export function CustomerManager({
  initialRows,
  total,
  page,
  pageSize,
  query,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const confirm = useConfirm();

  const [search, setSearch] = React.useState(query);
  const [editTarget, setEditTarget] = React.useState<EditTarget>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pushParams(next: { q?: string; page?: number; size?: number }) {
    const params = new URLSearchParams();
    const q = next.q ?? search;
    const p = next.page ?? page;
    const s = next.size ?? pageSize;
    if (q.trim()) params.set("q", q.trim());
    if (p > 1) params.set("page", String(p));
    if (s !== 10) params.set("size", String(s));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    pushParams({ q: search, page: 1 });
  }

  async function handleDelete(row: AdminCustomerRow) {
    const ok = await confirm({
      title: `Hapus ${row.name}?`,
      description:
        "Akun customer ini akan dihapus permanen. Hanya bisa kalau belum punya riwayat kunjungan.",
      confirmText: "Hapus",
      variant: "danger",
    });
    if (!ok) return;
    setDeleting(row.id);
    try {
      await deleteCustomer(row.id);
      toast.success(`${row.name} dihapus`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus customer"));
    } finally {
      setDeleting(null);
    }
  }

  function exportCsv() {
    const header = ["Nama", "Email", "Telepon", "Kunjungan", "Daftar"];
    const lines = initialRows.map((r) =>
      [
        r.name,
        r.email,
        r.phone ?? "",
        r.visit_count,
        new Date(r.created_at).toLocaleDateString("id-ID"),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearchSubmit} className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau email…"
            className="w-full h-10 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </form>
        <Button variant="outline" onClick={exportCsv} disabled={initialRows.length === 0}>
          <Download className="h-4 w-4" /> Export
        </Button>
        <Button variant="gold" onClick={() => setEditTarget({ mode: "create" })}>
          <UserPlus className="h-4 w-4" /> Tambah Customer
        </Button>
      </div>

      {/* List */}
      {initialRows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">
          {query ? `Tidak ada customer cocok "${query}".` : "Belum ada customer."}
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {initialRows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-3 sm:p-4">
              <Link
                href={`/admin/users/${r.id}`}
                className="flex items-center gap-3 flex-1 min-w-0 group"
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="text-xs">
                    {initials(r.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate group-hover:text-primary transition">
                      {r.name}
                    </span>
                    {!r.is_active && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-red-500/15 text-red-400 border-red-500/30"
                      >
                        Nonaktif
                      </Badge>
                    )}
                    {r.rating_count > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-primary">
                        <Star className="h-3 w-3 fill-primary" />
                        {r.rating_avg}
                        <span className="text-muted-foreground">
                          ({r.rating_count})
                        </span>
                      </span>
                    )}
                    {r.visit_count > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {r.visit_count}× kunjungan
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.email}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit"
                  onClick={() => setEditTarget({ mode: "edit", row: r })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Hapus"
                  disabled={deleting === r.id}
                  onClick={() => handleDelete(r)}
                >
                  {deleting === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-red-400" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Pagination — gaya seragam dgn admin lain (komponen page 0-based) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Per halaman:</span>
          <select
            value={pageSize}
            onChange={(e) => pushParams({ size: Number(e.target.value), page: 1 })}
            className="h-8 px-2 rounded-md bg-input border border-border text-xs focus:outline-none focus:border-primary"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="ml-1 hidden sm:inline">· {total} customer</span>
        </label>
        {totalPages > 1 && (
          <Pagination
            page={page - 1}
            totalPages={totalPages}
            onChange={(p) => pushParams({ page: p + 1 })}
          />
        )}
      </div>

      {editTarget && (
        <CustomerFormDialog
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CustomerFormDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Exclude<EditTarget, null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = target.mode === "edit";
  const row = isEdit ? target.row : null;

  const [name, setName] = React.useState(row?.name ?? "");
  const [email, setEmail] = React.useState(row?.email ?? "");
  const [phone, setPhone] = React.useState(row?.phone ?? "");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isActive, setIsActive] = React.useState(row?.is_active ?? true);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validasi password (edit: opsional; kalau diisi harus cocok & min 6).
    if (isEdit && (password || confirmPassword)) {
      if (password.length < 6) {
        toast.error("Password baru minimal 6 karakter");
        return;
      }
      if (password !== confirmPassword) {
        toast.error("Konfirmasi password tidak cocok");
        return;
      }
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateCustomer({
          id: row!.id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          password: password || undefined,
          isActive,
        });
        toast.success(
          password ? "Customer & password diperbarui" : "Customer diperbarui"
        );
      } else {
        await createCustomer({
          name: name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
        });
        toast.success("Customer dibuat");
      }
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan customer"));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Customer" : "Tambah Customer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nama">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="mis. Budi Santoso"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={120}
              placeholder="mis. budi@email.com"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>
          <Field label="Telepon (opsional)">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              placeholder="mis. 081234567890"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>
          {!isEdit ? (
            <Field label="Password">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={100}
                placeholder="Minimal 6 karakter"
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
          ) : (
            <div className="rounded-md border border-border p-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Reset password (opsional) — isi kalau customer lupa password.
                Kosongkan kalau tidak diubah.
              </p>
              <Field label="Password baru">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  maxLength={100}
                  placeholder="Minimal 6 karakter"
                  className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
                />
              </Field>
              <Field label="Konfirmasi password baru">
                <input
                  type="text"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  maxLength={100}
                  placeholder="Ulangi password baru"
                  className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
                />
              </Field>
            </div>
          )}

          {/* Status aktif (edit) — nonaktif = tak bisa login */}
          {isEdit && (
            <Field label="Status akun">
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border px-3 h-10 text-sm transition",
                  isActive
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
                )}
              >
                <span>{isActive ? "Aktif" : "Nonaktif (tak bisa login)"}</span>
                <span className="text-xs opacity-70">
                  {isActive ? "Ketuk untuk nonaktifkan" : "Ketuk untuk aktifkan"}
                </span>
              </button>
            </Field>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
                </>
              ) : isEdit ? (
                "Simpan"
              ) : (
                "Buat Akun"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
    </label>
  );
}
