"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  UserPlus,
  Loader2,
  Users,
  Pencil,
  Copy,
  Check,
  Armchair,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { EDUCATION_OPTIONS } from "@/lib/education";
import { RELIGION_OPTIONS } from "@/lib/religion";
import { initials, getActionErrorMessage, cn } from "@/lib/utils";
import {
  createCustomerByStaff,
  updateCustomerByStaff,
  getCustomerForStaff,
  type StaffCustomerRow,
} from "@/lib/staff-customer-actions";

interface Props {
  initialRows: StaffCustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
}

type FormTarget =
  | { mode: "create" }
  | { mode: "edit"; id: string; name: string }
  | null;

export function CashierCustomerList({
  initialRows,
  total,
  page,
  pageSize,
  query,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = React.useState(query);
  const [target, setTarget] = React.useState<FormTarget>(null);
  /** Kredensial yang baru dibuat/di-reset — ditampilkan ke kasir sekali. */
  const [creds, setCreds] = React.useState<{
    name: string;
    email: string;
    password: string;
  } | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pushParams(next: { q?: string; page?: number }) {
    const params = new URLSearchParams();
    const q = next.q ?? search;
    const p = next.page ?? page;
    if (q.trim()) params.set("q", q.trim());
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: search + tambah */}
      <div className="flex items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pushParams({ q: search, page: 1 });
          }}
          className="relative flex-1 min-w-0"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, username, email, phone…"
            className="w-full h-10 pl-9 pr-3 rounded-lg bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
        </form>
        <Button
          variant="gold"
          onClick={() => setTarget({ mode: "create" })}
          className="shrink-0"
        >
          <UserPlus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {/* List */}
      {initialRows.length === 0 ? (
        <div className="rounded-xl border border-border bg-gradient-to-b from-card to-primary/[0.04] p-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
            <Users className="h-7 w-7 text-primary/70" />
          </div>
          <p className="text-sm font-medium mb-1">
            {query ? "No customer found" : "No customers yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {query
              ? `Nothing matches "${query}".`
              : "Add a customer for guests who came without their phone."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {initialRows.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3"
            >
              <Avatar className="h-10 w-10 shrink-0">
                {c.avatar_url && <AvatarImage src={c.avatar_url} alt={c.name} />}
                <AvatarFallback className="text-xs">
                  {initials(c.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold truncate">
                    {c.name}
                  </span>
                  {!c.is_active && (
                    <span className="rounded-full border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">
                      Inactive
                    </span>
                  )}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {c.membership_name}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {c.username ? `@${c.username} · ` : ""}
                  {c.phone || c.email}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {c.visit_count}× visits
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {c.is_active && (
                  <Link
                    href={`/staff/open-table?from=customers&customer=${c.id}`}
                    aria-label={`Open table for ${c.name}`}
                    title="Open table for this customer"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary transition hover:bg-primary/20"
                  >
                    <Armchair className="h-4 w-4" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setTarget({ mode: "edit", id: c.id, name: c.name })
                  }
                  aria-label={`Edit ${c.name}`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground hover:bg-muted/50"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination sederhana */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => pushParams({ page: page - 1 })}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => pushParams({ page: page + 1 })}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Form tambah/edit */}
      {target && (
        <CustomerFormSheet
          target={target}
          onClose={() => setTarget(null)}
          onCreated={(c) => {
            setTarget(null);
            setCreds(c);
            router.refresh();
          }}
          onUpdated={() => {
            setTarget(null);
            toast.success("Customer updated");
            router.refresh();
          }}
        />
      )}

      {/* Kredensial login untuk diberikan ke pelanggan */}
      {creds && (
        <CredentialsSheet creds={creds} onClose={() => setCreds(null)} />
      )}
    </div>
  );
}

/** Sheet menampilkan email + password default untuk diberikan ke pelanggan. */
function CredentialsSheet({
  creds,
  onClose,
}: {
  creds: { name: string; email: string; password: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `Email: ${creds.email}\nPassword: ${creds.password}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy. Note it manually.");
    }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border border-border bg-card p-4 pb-6 sm:pb-4">
        <h3 className="text-sm font-semibold">Login for {creds.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Give these to the customer. Ask them to change the password after
          their first sign-in.
        </p>
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/20 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Email</span>
            <span className="truncate font-medium">{creds.email}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Password</span>
            <span className="font-mono font-semibold text-primary">
              {creds.password}
            </span>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={copy} className="flex-1">
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="gold" onClick={onClose} className="flex-1">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Form tambah/edit pelanggan (bottom sheet, ramah layar kasir). */
function CustomerFormSheet({
  target,
  onClose,
  onCreated,
  onUpdated,
}: {
  target: Exclude<FormTarget, null>;
  onClose: () => void;
  onCreated: (c: { name: string; email: string; password: string }) => void;
  onUpdated: () => void;
}) {
  const isEdit = target.mode === "edit";
  const [loading, setLoading] = React.useState(isEdit);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [gender, setGender] = React.useState("");
  const [interestedIn, setInterestedIn] = React.useState("");
  const [area, setArea] = React.useState("");
  const [education, setEducation] = React.useState("");
  const [heightCm, setHeightCm] = React.useState("");
  const [religion, setReligion] = React.useState("");
  const [socialLink, setSocialLink] = React.useState("");

  // Muat data saat mode edit.
  React.useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    getCustomerForStaff(target.id)
      .then((c) => {
        if (!alive || !c) return;
        setName(c.name);
        setUsername(c.username ?? "");
        setEmail(c.email);
        setPhone(c.phone ?? "");
        setBirthDate(c.birthDate ?? "");
        setGender(c.gender ?? "");
        setInterestedIn(c.interestedIn ?? "");
        setArea(c.area ?? "");
        setEducation(c.education ?? "");
        setHeightCm(c.heightCm ? String(c.heightCm) : "");
        setReligion(c.religion ?? "");
        setSocialLink(c.socialLink ?? "");
      })
      .catch((err) =>
        toast.error(getActionErrorMessage(err, "Failed to load customer"))
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  function payload() {
    const h = heightCm.trim() ? Number(heightCm) : undefined;
    return {
      name: name.trim(),
      email: email.trim(),
      username: username.trim() || undefined,
      phone: phone.trim() || undefined,
      birthDate: birthDate || undefined,
      gender: (gender || undefined) as "male" | "female" | undefined,
      interestedIn: (interestedIn || undefined) as
        | "male"
        | "female"
        | "both"
        | undefined,
      area: area.trim() || undefined,
      education: (education || undefined) as never,
      heightCm: Number.isFinite(h) ? h : undefined,
      religion: (religion || undefined) as never,
      socialLink: socialLink.trim() || undefined,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        await updateCustomerByStaff({ id: target.id, ...payload() });
        onUpdated();
      } else {
        const res = await createCustomerByStaff(payload());
        onCreated({
          name: name.trim(),
          email: res.email,
          password: res.password,
        });
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save customer"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-t-2xl border border-border bg-card sm:max-w-lg sm:rounded-2xl">
        <div className="shrink-0 border-b border-border p-4">
          <h3 className="text-sm font-semibold">
            {isEdit ? `Edit ${target.name}` : "Add customer"}
          </h3>
          {!isEdit && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              A default password is generated and shown after saving.
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <Field label="Name" required>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="lowercase, 3-20"
                    className={inputCls}
                  />
                </Field>
                <Field label="WhatsApp number">
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    maxLength={20}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Email" required>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={120}
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of birth">
                  <DatePicker
                    value={birthDate}
                    onChange={setBirthDate}
                    placeholder="Select date"
                    ariaLabel="Date of birth"
                  />
                </Field>
                <Field label="Gender">
                  <Select
                    value={gender}
                    onChange={setGender}
                    ariaLabel="Gender"
                    options={[
                      { value: "", label: "Not set" },
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                    ]}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Interested in">
                  <Select
                    value={interestedIn}
                    onChange={setInterestedIn}
                    ariaLabel="Interested in"
                    options={[
                      { value: "", label: "Not set" },
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                      { value: "both", label: "Both" },
                    ]}
                  />
                </Field>
                <Field label="Height (cm)">
                  <input
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    inputMode="numeric"
                    placeholder="120-230"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Address">
                <input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  maxLength={120}
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Education">
                  <Select
                    value={education}
                    onChange={setEducation}
                    ariaLabel="Education"
                    options={[
                      { value: "", label: "Not set" },
                      ...EDUCATION_OPTIONS.map((o) => ({
                        value: o.value,
                        label: o.label,
                      })),
                    ]}
                  />
                </Field>
                <Field label="Religion">
                  <Select
                    value={religion}
                    onChange={setReligion}
                    ariaLabel="Religion"
                    options={[
                      { value: "", label: "Not set" },
                      ...RELIGION_OPTIONS.map((o) => ({
                        value: o.value,
                        label: o.label,
                      })),
                    ]}
                  />
                </Field>
              </div>
              <Field label="Social media">
                <input
                  value={socialLink}
                  onChange={(e) => setSocialLink(e.target.value)}
                  placeholder="@handle or link"
                  maxLength={200}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="shrink-0 border-t border-border p-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="gold"
                disabled={saving}
                className="flex-1"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEdit ? "Save" : "Create"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className={cn("block text-xs text-muted-foreground")}>
        {label}
        {required && <span className="text-primary"> *</span>}
      </label>
      {children}
    </div>
  );
}
