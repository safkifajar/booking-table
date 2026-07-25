"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { EDUCATION_OPTIONS } from "@/lib/education";
import { RELIGION_OPTIONS } from "@/lib/religion";
import {
  Search,
  UserPlus,
  Download,
  Loader2,
  Star,
  Users,
} from "lucide-react";
import { Pagination } from "@/components/admin/Pagination";
import { initials, getActionErrorMessage, cn } from "@/lib/utils";
import {
  createCustomer,
  exportCustomers,
  type AdminCustomerRow,
  type CustomerStats,
} from "@/lib/customer-actions";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

type SortMode = "default" | "visit_desc" | "visit_asc";

interface Props {
  initialRows: AdminCustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  status: "all" | "active" | "inactive";
  membership: "all" | "basic" | "premium" | "vip";
  sort: SortMode;
  stats: CustomerStats;
}

/** Dialog hanya untuk TAMBAH customer. Edit dilakukan di halaman detail
 * (/admin/users/[id]). */
type EditTarget = { mode: "create" } | null;

export function CustomerManager({
  initialRows,
  total,
  page,
  pageSize,
  query,
  status,
  membership,
  sort,
  stats,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = React.useState(query);
  const [editTarget, setEditTarget] = React.useState<EditTarget>(null);
  const [exporting, setExporting] = React.useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pushParams(next: {
    q?: string;
    page?: number;
    size?: number;
    status?: string;
    membership?: string;
    sort?: string;
  }) {
    const params = new URLSearchParams();
    const q = next.q ?? search;
    const p = next.page ?? page;
    const s = next.size ?? pageSize;
    const st = next.status ?? status;
    const mb = next.membership ?? membership;
    const sr = next.sort ?? sort;
    if (q.trim()) params.set("q", q.trim());
    if (p > 1) params.set("page", String(p));
    if (s !== 10) params.set("size", String(s));
    if (st !== "all") params.set("status", st);
    if (mb !== "all") params.set("membership", mb);
    if (sr !== "default") params.set("sort", sr);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Toggle sort kolom Visits: default → desc → asc → default.
  function toggleVisitSort() {
    const nextSort: SortMode =
      sort === "default"
        ? "visit_desc"
        : sort === "visit_desc"
          ? "visit_asc"
          : "default";
    pushParams({ sort: nextSort, page: 1 });
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    pushParams({ q: search, page: 1 });
  }

  /**
   * Export CSV data diri LENGKAP (termasuk hobi & ketertarikan). Ambil SEMUA
   * customer sesuai filter aktif (bukan cuma halaman ini) via server action.
   */
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows = await exportCustomers(search, { status, membership });
      const header = [
        "Name",
        "Username",
        "Email",
        "WhatsApp number",
        "Gender",
        "Interested in",
        "Looking for",
        "Birth date",
        "Area",
        "Education",
        "Religion",
        "Height (cm)",
        "Hobbies & interests",
        "Bio",
        "Social link",
        "Visits",
        "Friends",
        "Rating avg",
        "Rating count",
        "Membership",
        "Status",
        "Registered",
      ];
      const lines = rows.map((r) =>
        [
          r.name,
          r.username ?? "",
          r.email,
          r.phone ?? "",
          r.gender ?? "",
          r.interested_in ?? "",
          r.looking_for ?? "",
          r.birth_date ?? "",
          r.area ?? "",
          r.education ?? "",
          r.religion ?? "",
          r.height_cm ?? "",
          r.hobbies.join("; "),
          r.bio ?? "",
          r.social_link ?? "",
          r.visit_count,
          r.friend_count,
          r.rating_count > 0 ? r.rating_avg : "",
          r.rating_count,
          r.membership_name,
          r.is_active ? "Active" : "Inactive",
          new Date(r.created_at).toLocaleDateString("en-GB"),
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      // BOM agar Excel membaca UTF-8 (emoji/aksen di hobi & bio tak rusak).
      const csv = "﻿" + [header.join(","), ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getActionErrorMessage(e, "Failed to export customers."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Statistik ringkas — klik kartu = filter cepat. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard
          label="Total"
          value={stats.total}
          active={status === "all" && membership === "all"}
          onClick={() => pushParams({ status: "all", membership: "all", page: 1 })}
        />
        <StatCard
          label="Active"
          value={stats.active}
          tone="emerald"
          active={status === "active"}
          onClick={() =>
            pushParams({
              status: status === "active" ? "all" : "active",
              page: 1,
            })
          }
        />
        <StatCard
          label="Inactive"
          value={stats.inactive}
          tone="red"
          active={status === "inactive"}
          onClick={() =>
            pushParams({
              status: status === "inactive" ? "all" : "inactive",
              page: 1,
            })
          }
        />
        <StatCard
          label="Basic"
          value={stats.basic}
          active={membership === "basic"}
          onClick={() =>
            pushParams({
              membership: membership === "basic" ? "all" : "basic",
              page: 1,
            })
          }
        />
        <StatCard
          label="Premium"
          value={stats.premium}
          tone="primary"
          active={membership === "premium"}
          onClick={() =>
            pushParams({
              membership: membership === "premium" ? "all" : "premium",
              page: 1,
            })
          }
        />
        <StatCard
          label="VIP"
          value={stats.vip}
          tone="purple"
          active={membership === "vip"}
          onClick={() =>
            pushParams({
              membership: membership === "vip" ? "all" : "vip",
              page: 1,
            })
          }
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearchSubmit} className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, username, or email…"
            className="w-full h-10 pl-9 pr-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </form>
        {/* Filter membership + status (server-side, seperti list transaksi). */}
        <Select
          value={membership}
          onChange={(v) => pushParams({ membership: v, page: 1 })}
          options={[
            { value: "all", label: "All membership" },
            { value: "basic", label: "Basic" },
            { value: "premium", label: "Premium" },
            { value: "vip", label: "VIP" },
          ]}
          className="shrink-0 min-w-[140px]"
          ariaLabel="Filter membership"
        />
        <Select
          value={status}
          onChange={(v) => pushParams({ status: v, page: 1 })}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          className="shrink-0 min-w-[130px]"
          ariaLabel="Filter status"
        />
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={total === 0 || exporting}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {exporting ? "Exporting…" : "Export"}
        </Button>
        <Button variant="gold" onClick={() => setEditTarget({ mode: "create" })}>
          <UserPlus className="h-4 w-4" /> Add Customer
        </Button>
      </div>

      {/* Table */}
      {initialRows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">
          {query ? `No customer matches "${query}".` : "No customers yet."}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium w-24">Status</th>
                  <th className="px-4 py-3 font-medium w-24">
                    <button
                      type="button"
                      onClick={toggleVisitSort}
                      className={
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -ml-1.5 transition hover:bg-muted/60 " +
                        (sort !== "default" ? "text-primary" : "")
                      }
                      title="Sort by visits"
                    >
                      Visits
                      {sort === "visit_desc" ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : sort === "visit_asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium w-28">Membership</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {initialRows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20 transition">
                    {/* Customer */}
                    <td className="px-4 py-2.5 align-middle">
                      <Link
                        href={`/admin/users/${r.id}`}
                        className="flex items-center gap-3 min-w-0 group"
                      >
                        <Avatar className="h-9 w-9 shrink-0">
                          {r.avatar_url && (
                            <AvatarImage src={r.avatar_url} alt={r.name} />
                          )}
                          <AvatarFallback className="text-xs">
                            {initials(r.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium truncate group-hover:text-primary transition">
                              {r.name}
                            </span>
                            {r.rating_count > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] text-primary shrink-0">
                                <Star className="h-3 w-3 fill-primary" />
                                {r.rating_avg}
                              </span>
                            )}
                          </div>
                          {r.username && (
                            <div className="text-xs text-muted-foreground truncate">
                              @{r.username}
                            </div>
                          )}
                        </div>
                      </Link>
                    </td>

                    {/* Contact */}
                    <td className="px-4 py-2.5 align-middle min-w-0">
                      <div className="text-xs truncate">{r.email}</div>
                      {r.phone && (
                        <div className="text-xs text-muted-foreground truncate">
                          {r.phone}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5 align-middle">
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
                    </td>

                    {/* Visits */}
                    <td className="px-4 py-2.5 align-middle">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">{r.visit_count}×</span>
                        {r.friend_count > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Users className="h-3 w-3" />
                            {r.friend_count}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Membership */}
                    <td className="px-4 py-2.5 align-middle">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px]",
                          r.membership_key === "vip"
                            ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                            : r.membership_key === "premium"
                              ? "bg-primary/15 text-primary border-primary/30"
                              : "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {r.membership_name}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

/** Kartu statistik ringkas — klik untuk filter cepat. */
function StatCard({
  label,
  value,
  tone = "muted",
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "muted" | "emerald" | "red" | "primary" | "purple";
  active?: boolean;
  onClick: () => void;
}) {
  const toneRing: Record<string, string> = {
    muted: "ring-border",
    emerald: "ring-emerald-500/40",
    red: "ring-red-500/40",
    primary: "ring-primary/40",
    purple: "ring-purple-500/40",
  };
  const toneText: Record<string, string> = {
    muted: "text-foreground",
    emerald: "text-emerald-500",
    red: "text-red-500",
    primary: "text-primary",
    purple: "text-purple-500",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl border bg-card px-3 py-2.5 text-left transition hover:bg-muted/40 " +
        (active
          ? `border-transparent ring-2 ${toneRing[tone]}`
          : "border-border")
      }
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={"text-lg font-bold tabular-nums " + toneText[tone]}>
        {value}
      </div>
    </button>
  );
}

function CustomerFormDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [gender, setGender] = React.useState<"" | "male" | "female">("");
  const [interestedIn, setInterestedIn] = React.useState<
    "" | "male" | "female" | "both"
  >("");
  const [birthDate, setBirthDate] = React.useState("");
  const [socialLink, setSocialLink] = React.useState("");
  const [area, setArea] = React.useState("");
  const [education, setEducation] = React.useState("");
  const [heightCm, setHeightCm] = React.useState("");
  const [religion, setReligion] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    // Field profil — samakan dgn form edit profil (create customer lengkap).
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
      await createCustomer({
        name: name.trim(),
        username: username.trim().toLowerCase() || undefined,
        email: email.trim(),
        password,
        ...profilePayload,
      });
      toast.success("Customer created");
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save customer"));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add Customer</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col min-h-0 flex-1"
        >
          {/* Body scrollable — header & footer tetap. -mx/px biar scrollbar
              tak menempel field. */}
          <div className="space-y-3 overflow-y-auto min-h-0 flex-1 -mx-1 px-1">
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
          <Field label="Username (optional)">
            <input
              type="text"
              value={username}
              onChange={(e) =>
                setUsername(
                  e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")
                )
              }
              minLength={3}
              maxLength={20}
              placeholder="e.g. budi_santoso"
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
          </div>

          <DialogFooter className="shrink-0 border-t border-border pt-3 mt-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
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
