"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Mail, Phone, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { EDUCATION_OPTIONS, educationLabel } from "@/lib/education";
import { RELIGION_OPTIONS, religionLabel } from "@/lib/religion";
import { CustomerReviews, CustomerHistory } from "./CustomerDetailSections";
import { updateCustomer, setCustomerPassword } from "@/lib/customer-actions";
import { cn, getActionErrorMessage } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { UserReviewEntry, UserTableHistoryEntry } from "@/types/db";

type Gender = "" | "male" | "female";
type InterestedIn = "" | "male" | "female" | "both";

interface CustomerData {
  id: string;
  name: string;
  username: string | null;
  email: string;
  phone: string | null;
  birthDate: string | null;
  gender: Gender;
  interestedIn: InterestedIn;
  socialLink: string | null;
  area: string | null;
  education: string | null;
  heightCm: number | null;
  religion: string | null;
  isActive: boolean;
  bio: string | null;
  hobbies: string[];
}

const TABS = [
  { key: "detail", label: "Detail" },
  { key: "review", label: "Review" },
  { key: "history", label: "History" },
  { key: "password", label: "Change Password" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function genderLabel(g: string): string {
  return g === "male" ? "Male" : g === "female" ? "Female" : "—";
}
/** Umur (tahun penuh) dari tanggal lahir ISO. */
function ageFrom(iso: string): number {
  const b = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}
/** Jadikan href valid: kalau sudah http(s) pakai apa adanya; kalau username/
 * domain tanpa skema, prefix https://. */
function socialHref(v: string): string {
  const s = v.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("@")) return `https://instagram.com/${s.slice(1)}`;
  return `https://${s}`;
}
function birthDateLabel(iso: string | null): string {
  if (!iso) return "—";
  const tgl = new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" });
  return `${tgl} · ${ageFrom(iso)} yrs`;
}
function interestLabel(v: string): string {
  return v === "male"
    ? "Male"
    : v === "female"
      ? "Female"
      : v === "both"
        ? "Both"
        : "—";
}

export function CustomerDetailTabs({
  customer,
  reviews,
  history,
}: {
  customer: CustomerData;
  reviews: UserReviewEntry[];
  history: UserTableHistoryEntry[];
}) {
  const [tab, setTab] = React.useState<TabKey>("detail");

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "detail" && <DetailTab customer={customer} />}
      {tab === "review" && (
        <div>
          <h2 className="text-sm font-semibold mb-2">
            Reviews from other visitors{" "}
            <span className="text-muted-foreground font-normal">
              ({reviews.length})
            </span>
          </h2>
          <CustomerReviews reviews={reviews} />
        </div>
      )}
      {tab === "history" && (
        <div>
          <h2 className="text-sm font-semibold mb-2">
            Open Table History{" "}
            <span className="text-muted-foreground font-normal">
              ({history.length})
            </span>
          </h2>
          <CustomerHistory history={history} />
          <p className="text-[11px] text-muted-foreground mt-2">
            Tap a history entry to see details: who was at the table & what was
            ordered.
          </p>
        </div>
      )}
      {tab === "password" && <PasswordTab customerId={customer.id} />}
    </div>
  );
}

/* ---------- Tab Detail (read-only + edit inline) ---------- */
function DetailTab({ customer }: { customer: CustomerData }) {
  const [editing, setEditing] = React.useState(false);
  if (editing) {
    return <EditForm customer={customer} onDone={() => setEditing(false)} />;
  }
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Customer Information</h2>
        <Button size="sm" variant="gold" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" /> Edit
        </Button>
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <Row label="Name" value={customer.name} />
        <Row label="Username" value={customer.username ? `@${customer.username}` : "—"} />
        <Row
          label="Email"
          value={customer.email}
          icon={<Mail className="h-3.5 w-3.5" />}
        />
        <Row
          label="WhatsApp number"
          value={customer.phone || "—"}
          icon={<Phone className="h-3.5 w-3.5" />}
        />
        <Row label="Date of birth" value={birthDateLabel(customer.birthDate)} />
        <Row
          label="Status"
          value={customer.isActive ? "Active" : "Inactive"}
          valueClass={customer.isActive ? "text-emerald-400" : "text-red-400"}
        />
        <Row label="Gender" value={genderLabel(customer.gender)} />
        <Row label="Interested in" value={interestLabel(customer.interestedIn)} />
        <Row label="Address" value={customer.area || "—"} />
        <Row
          label="Education"
          value={educationLabel(customer.education) || "—"}
        />
        <Row
          label="Height"
          value={customer.heightCm ? `${customer.heightCm} cm` : "—"}
        />
        <Row label="Religion" value={religionLabel(customer.religion) || "—"} />
        <div className="flex items-center justify-between gap-4 border-b border-border/40 pb-2">
          <dt className="text-muted-foreground">Social media</dt>
          <dd className="font-medium text-right min-w-0">
            {customer.socialLink ? (
              <a
                href={socialHref(customer.socialLink)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1 truncate"
              >
                <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{customer.socialLink}</span>
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {customer.bio && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">Bio</div>
          <p className="text-sm whitespace-pre-line">{customer.bio}</p>
        </div>
      )}
      {customer.hobbies.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1.5">Hobbies & interests</div>
          <HobbyBadges hobbies={customer.hobbies} max={20} />
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  icon,
  valueClass,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-medium text-right inline-flex items-center gap-1.5 min-w-0",
          valueClass
        )}
      >
        {icon}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}

/* ---------- Edit form (inline di tab Detail) ---------- */
function EditForm({
  customer,
  onDone,
}: {
  customer: CustomerData;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(customer.name);
  const [username, setUsername] = React.useState(customer.username ?? "");
  const [email, setEmail] = React.useState(customer.email);
  const [phone, setPhone] = React.useState(customer.phone ?? "");
  const [birthDate, setBirthDate] = React.useState(customer.birthDate ?? "");
  const [socialLink, setSocialLink] = React.useState(customer.socialLink ?? "");
  const [gender, setGender] = React.useState<Gender>(customer.gender);
  const [interestedIn, setInterestedIn] = React.useState<InterestedIn>(
    customer.interestedIn
  );
  const [area, setArea] = React.useState(customer.area ?? "");
  const [education, setEducation] = React.useState(customer.education ?? "");
  const [heightCm, setHeightCm] = React.useState(
    customer.heightCm != null ? String(customer.heightCm) : ""
  );
  const [religion, setReligion] = React.useState(customer.religion ?? "");
  const [isActive, setIsActive] = React.useState(customer.isActive);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 1) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await updateCustomer({
        id: customer.id,
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
        socialLink: socialLink.trim() || undefined,
        isActive,
        gender: gender || undefined,
        interestedIn: interestedIn || undefined,
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
      });
      toast.success("Customer updated");
      router.refresh();
      onDone();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save customer"));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-5 space-y-3"
    >
      <h2 className="text-sm font-semibold mb-1">Edit Customer</h2>
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>
      <Field label="Username (optional)">
        <input
          type="text"
          value={username}
          onChange={(e) =>
            setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
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
      <Field label="Date of birth (optional)">
        <DatePicker
          value={birthDate}
          onChange={setBirthDate}
          max={new Date().toISOString().slice(0, 10)}
        />
      </Field>
      <Field label="Social media (optional)">
        <input
          type="text"
          value={socialLink}
          onChange={(e) => setSocialLink(e.target.value)}
          maxLength={200}
          placeholder="e.g. instagram.com/username or @username"
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>

      <Field label="Gender (optional)">
        <Segmented
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ]}
          value={gender}
          onChange={(v) => setGender(v as Gender)}
        />
      </Field>
      <Field label="Interested in (optional)">
        <Segmented
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
            { value: "both", label: "Both" },
          ]}
          value={interestedIn}
          onChange={(v) => setInterestedIn(v as InterestedIn)}
        />
      </Field>

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

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </form>
  );
}

/* ---------- Tab Ubah Password ---------- */
function PasswordTab({ customerId }: { customerId: string }) {
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Password confirmation does not match");
      return;
    }
    setSaving(true);
    try {
      await setCustomerPassword({ id: customerId, password });
      toast.success("Customer password updated");
      setPassword("");
      setConfirm("");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to change password"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-5 space-y-3 max-w-md"
    >
      <h2 className="text-sm font-semibold mb-1">Change Password</h2>
      <p className="text-xs text-muted-foreground">
        Set a new password for this customer. The customer can log in with this
        new password.
      </p>
      <Field label="New password">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          placeholder="At least 6 characters"
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>
      <Field label="Confirm password">
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat new password"
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>
      <div className="flex justify-end pt-1">
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save Password"
          )}
        </Button>
      </div>
    </form>
  );
}

/* ---------- helpers ---------- */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(value === opt.value ? "" : opt.value)}
          className={cn(
            "flex-1 h-10 rounded-md border text-sm transition",
            value === opt.value
              ? "bg-primary/15 border-primary/40 text-primary"
              : "bg-input border-border hover:border-primary/30"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
