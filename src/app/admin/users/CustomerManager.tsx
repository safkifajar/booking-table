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
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { EDUCATION_OPTIONS } from "@/lib/education";
import { RELIGION_OPTIONS } from "@/lib/religion";
import {
  Search,
  UserPlus,
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
      title: `Delete ${row.name}?`,
      description:
        "This customer account will be permanently deleted. Only possible if they have no visit history.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setDeleting(row.id);
    try {
      await deleteCustomer(row.id);
      toast.success(`${row.name} deleted`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to delete customer"));
    } finally {
      setDeleting(null);
    }
  }

  function exportCsv() {
    const header = ["Name", "Email", "WhatsApp number", "Visits", "Registered"];
    const lines = initialRows.map((r) =>
      [
        r.name,
        r.email,
        r.phone ?? "",
        r.visit_count,
        new Date(r.created_at).toLocaleDateString("en-US"),
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
            placeholder="Search name or email…"
            className="w-full h-10 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </form>
        <Button variant="outline" onClick={exportCsv} disabled={initialRows.length === 0}>
          <Download className="h-4 w-4" /> Export
        </Button>
        <Button variant="gold" onClick={() => setEditTarget({ mode: "create" })}>
          <UserPlus className="h-4 w-4" /> Add Customer
        </Button>
      </div>

      {/* List */}
      {initialRows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">
          {query ? `No customer matches "${query}".` : "No customers yet."}
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
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px]",
                        r.is_active
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30"
                      )}
                    >
                      {r.is_active ? "Active" : "Inactive"}
                    </Badge>
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
                        {r.visit_count}× visits
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
                  aria-label="Delete"
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
          <span>Per page:</span>
          <Select
            value={String(pageSize)}
            onChange={(v) => pushParams({ size: Number(v), page: 1 })}
            options={[
              { value: "10", label: "10" },
              { value: "25", label: "25" },
              { value: "50", label: "50" },
              { value: "100", label: "100" },
            ]}
            ariaLabel="Per page"
          />
          <span className="ml-1 hidden sm:inline">· {total} customers</span>
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
  const [gender, setGender] = React.useState<"" | "male" | "female">(
    (row?.gender as "" | "male" | "female") ?? ""
  );
  const [interestedIn, setInterestedIn] = React.useState<
    "" | "male" | "female" | "both"
  >((row?.interested_in as "" | "male" | "female" | "both") ?? "");
  const [birthDate, setBirthDate] = React.useState(row?.birth_date ?? "");
  const [socialLink, setSocialLink] = React.useState(row?.social_link ?? "");
  const [area, setArea] = React.useState(row?.area ?? "");
  const [education, setEducation] = React.useState(row?.education ?? "");
  const [heightCm, setHeightCm] = React.useState(
    row?.height_cm != null ? String(row.height_cm) : ""
  );
  const [religion, setReligion] = React.useState(row?.religion ?? "");
  const [bio, setBio] = React.useState(row?.bio ?? "");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validasi password (edit: opsional; kalau diisi harus cocok & min 6).
    if (isEdit && (password || confirmPassword)) {
      if (password.length < 6) {
        toast.error("New password must be at least 6 characters");
        return;
      }
      if (password !== confirmPassword) {
        toast.error("Password confirmation does not match");
        return;
      }
    }
    setSaving(true);
    // Field profil bersama (create & update) — samakan dgn form edit profil.
    const profilePayload = {
      phone: phone.trim() || undefined,
      gender: gender || undefined,
      interestedIn: interestedIn || undefined,
      birthDate: birthDate || undefined,
      socialLink: socialLink.trim() || undefined,
      area: area.trim() || undefined,
      education:
        (education as
          | "high_school"
          | "diploma"
          | "bachelor"
          | "master"
          | "doctorate"
          | "other"
          | "") || undefined,
      heightCm: heightCm.trim()
        ? Math.min(230, Math.max(120, parseInt(heightCm, 10) || 120))
        : null,
      religion:
        (religion as
          | "islam"
          | "christian"
          | "catholic"
          | "hindu"
          | "buddhist"
          | "confucian"
          | "spiritual"
          | "") || undefined,
      bio: bio.trim() || undefined,
    };
    try {
      if (isEdit) {
        await updateCustomer({
          id: row!.id,
          name: name.trim(),
          email: email.trim(),
          password: password || undefined,
          isActive,
          ...profilePayload,
        });
        toast.success(
          password ? "Customer & password updated" : "Customer updated"
        );
      } else {
        await createCustomer({
          name: name.trim(),
          email: email.trim(),
          password,
          ...profilePayload,
        });
        toast.success("Customer created");
      }
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save customer"));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Customer" : "Add Customer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="e.g. Budi Santoso"
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
              placeholder="e.g. budi@email.com"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>
          <Field label="WhatsApp number (optional)">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              placeholder="e.g. 081234567890"
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
                placeholder="At least 6 characters"
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
          ) : (
            <div className="rounded-md border border-border p-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Reset password (optional) — fill in if the customer forgot their
                password. Leave blank if unchanged.
              </p>
              <Field label="New password">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  maxLength={100}
                  placeholder="At least 6 characters"
                  className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="text"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  maxLength={100}
                  placeholder="Repeat new password"
                  className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
                />
              </Field>
            </div>
          )}

          {/* Jenis kelamin (opsional) */}
          <Field label="Gender (optional)">
            <div className="flex gap-2">
              {([
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setGender((g) => (g === opt.value ? "" : opt.value))
                  }
                  className={cn(
                    "flex-1 h-10 rounded-md border text-sm transition",
                    gender === opt.value
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-input border-border hover:border-primary/30"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Tertarik pada (opsional) */}
          <Field label="Interested in (optional)">
            <div className="flex gap-2">
              {([
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
                { value: "both", label: "Both" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setInterestedIn((v) => (v === opt.value ? "" : opt.value))
                  }
                  className={cn(
                    "flex-1 h-10 rounded-md border text-sm transition",
                    interestedIn === opt.value
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-input border-border hover:border-primary/30"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Date of birth (opsional) */}
          <Field label="Date of birth (optional)">
            <DatePicker
              value={birthDate}
              onChange={setBirthDate}
              max={new Date().toISOString().slice(0, 10)}
            />
          </Field>

          {/* Address (opsional) */}
          <Field label="Address (optional)">
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              maxLength={120}
              placeholder="e.g. North Purwokerto"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>

          {/* Social media (opsional) */}
          <Field label="Social media (optional)">
            <input
              type="text"
              value={socialLink}
              onChange={(e) => setSocialLink(e.target.value)}
              maxLength={200}
              placeholder="@username"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>

          {/* Education (opsional) */}
          <Field label="Education (optional)">
            <Select
              value={education}
              onChange={setEducation}
              options={[
                { value: "", label: "Prefer not to say" },
                ...EDUCATION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                })),
              ]}
            />
          </Field>

          {/* Height (opsional) */}
          <Field label="Height cm (optional)">
            <input
              type="number"
              inputMode="numeric"
              min={120}
              max={230}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g. 170"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>

          {/* Religion (opsional) */}
          <Field label="Religion (optional)">
            <Select
              value={religion}
              onChange={setReligion}
              options={[
                { value: "", label: "Prefer not to say" },
                ...RELIGION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                })),
              ]}
            />
          </Field>

          {/* Bio (opsional) */}
          <Field label="Short bio (optional)">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="A short story about the customer"
              className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 resize-none"
            />
          </Field>

          {/* Status aktif (edit) — paling bawah; nonaktif = tak bisa login */}
          {isEdit && (
            <Field label="Account status">
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
                <span>{isActive ? "Active" : "Inactive"}</span>
                <span className="text-xs opacity-70">
                  {isActive ? "Tap to deactivate" : "Tap to activate"}
                </span>
              </button>
            </Field>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : isEdit ? (
                "Save"
              ) : (
                "Create Account"
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
