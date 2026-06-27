"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HobbyBadges } from "@/components/network/HobbyBadges";
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
  email: string;
  phone: string | null;
  birthDate: string | null;
  gender: Gender;
  interestedIn: InterestedIn;
  isActive: boolean;
  bio: string | null;
  hobbies: string[];
}

const TABS = [
  { key: "detail", label: "Detail" },
  { key: "review", label: "Review" },
  { key: "history", label: "Riwayat" },
  { key: "password", label: "Ubah Password" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function genderLabel(g: string): string {
  return g === "male" ? "Pria" : g === "female" ? "Wanita" : "—";
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
function birthDateLabel(iso: string | null): string {
  if (!iso) return "—";
  const tgl = new Date(iso).toLocaleDateString("id-ID", { dateStyle: "long" });
  return `${tgl} · ${ageFrom(iso)} thn`;
}
function interestLabel(v: string): string {
  return v === "male"
    ? "Pria"
    : v === "female"
      ? "Wanita"
      : v === "both"
        ? "Keduanya"
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
            Review dari pengunjung lain{" "}
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
            Riwayat Open Table{" "}
            <span className="text-muted-foreground font-normal">
              ({history.length})
            </span>
          </h2>
          <CustomerHistory history={history} />
          <p className="text-[11px] text-muted-foreground mt-2">
            Ketuk satu riwayat untuk lihat detail: siapa di meja & pesanan apa.
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
        <h2 className="text-sm font-semibold">Informasi Customer</h2>
        <Button size="sm" variant="gold" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" /> Edit
        </Button>
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <Row label="Nama" value={customer.name} />
        <Row
          label="Email"
          value={customer.email}
          icon={<Mail className="h-3.5 w-3.5" />}
        />
        <Row
          label="Nomor WA"
          value={customer.phone || "—"}
          icon={<Phone className="h-3.5 w-3.5" />}
        />
        <Row label="Tanggal lahir" value={birthDateLabel(customer.birthDate)} />
        <Row
          label="Status"
          value={customer.isActive ? "Aktif" : "Nonaktif"}
          valueClass={customer.isActive ? "text-emerald-400" : "text-red-400"}
        />
        <Row label="Jenis kelamin" value={genderLabel(customer.gender)} />
        <Row label="Tertarik pada" value={interestLabel(customer.interestedIn)} />
      </dl>
      {customer.bio && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">Bio</div>
          <p className="text-sm whitespace-pre-line">{customer.bio}</p>
        </div>
      )}
      {customer.hobbies.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1.5">Hobi & minat</div>
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
  const [email, setEmail] = React.useState(customer.email);
  const [phone, setPhone] = React.useState(customer.phone ?? "");
  const [birthDate, setBirthDate] = React.useState(customer.birthDate ?? "");
  const [gender, setGender] = React.useState<Gender>(customer.gender);
  const [interestedIn, setInterestedIn] = React.useState<InterestedIn>(
    customer.interestedIn
  );
  const [isActive, setIsActive] = React.useState(customer.isActive);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 1) {
      toast.error("Nama wajib diisi");
      return;
    }
    setSaving(true);
    try {
      await updateCustomer({
        id: customer.id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
        isActive,
        gender: gender || undefined,
        interestedIn: interestedIn || undefined,
      });
      toast.success("Customer diperbarui");
      router.refresh();
      onDone();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan customer"));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-5 space-y-3"
    >
      <h2 className="text-sm font-semibold mb-1">Edit Customer</h2>
      <Field label="Nama">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
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
      <Field label="Nomor WA (opsional)">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          placeholder="mis. 081234567890"
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>
      <Field label="Tanggal lahir (opsional)">
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>

      <Field label="Jenis kelamin (opsional)">
        <Segmented
          options={[
            { value: "male", label: "Pria" },
            { value: "female", label: "Wanita" },
          ]}
          value={gender}
          onChange={(v) => setGender(v as Gender)}
        />
      </Field>
      <Field label="Tertarik pada (opsional)">
        <Segmented
          options={[
            { value: "male", label: "Pria" },
            { value: "female", label: "Wanita" },
            { value: "both", label: "Keduanya" },
          ]}
          value={interestedIn}
          onChange={(v) => setInterestedIn(v as InterestedIn)}
        />
      </Field>

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
          <span>{isActive ? "Aktif" : "Nonaktif"}</span>
          <span className="text-xs opacity-70">
            {isActive ? "Ketuk untuk nonaktifkan" : "Ketuk untuk aktifkan"}
          </span>
        </button>
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
            </>
          ) : (
            "Simpan"
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
      toast.error("Password minimal 6 karakter");
      return;
    }
    if (password !== confirm) {
      toast.error("Konfirmasi password tidak cocok");
      return;
    }
    setSaving(true);
    try {
      await setCustomerPassword({ id: customerId, password });
      toast.success("Password customer diperbarui");
      setPassword("");
      setConfirm("");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal ubah password"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-5 space-y-3 max-w-md"
    >
      <h2 className="text-sm font-semibold mb-1">Ubah Password</h2>
      <p className="text-xs text-muted-foreground">
        Set password baru untuk customer ini. Customer bisa login dengan
        password baru ini.
      </p>
      <Field label="Password baru">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          placeholder="Minimal 6 karakter"
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>
      <Field label="Konfirmasi password">
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Ulangi password baru"
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>
      <div className="flex justify-end pt-1">
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
            </>
          ) : (
            "Simpan Password"
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
