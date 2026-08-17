"use client";

import * as React from "react";
import { toast } from "sonner";
import { Clock, CalendarCheck, Loader2, Save, Percent } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn, getActionErrorMessage, formatIDR } from "@/lib/utils";
import {
  updateOperatingHours,
  updateReservationConfig,
  updateChargeConfig,
  updateBarContact,
} from "@/lib/settings-actions";
import {
  DAY_KEYS,
  DAY_LABELS,
  computeBillTotals,
  type BarSettings,
  type ChargeConfig,
  type DayHours,
  type DayKey,
  type OperatingHours,
  type ReservationConfig,
  type RoundingMode,
} from "@/lib/settings-constants";

interface Props {
  barId: string;
  initial: BarSettings;
  /** Nomor WA CS tersimpan (null = belum diatur, pakai default). */
  initialContactWa: string | null;
}

export function SettingsManager({ barId, initial, initialContactWa }: Props) {
  return (
    <div className="space-y-6">
      <ContactSection barId={barId} initial={initialContactWa} />
      <OperatingHoursSection barId={barId} initial={initial.operatingHours} />
      <ReservationSection barId={barId} initial={initial.reservationConfig} />
      <ChargeSection barId={barId} initial={initial.chargeConfig} />
    </div>
  );
}

// ============================================================
// KONTAK CS (nomor WhatsApp)
// ============================================================

/**
 * Nomor WA CS — dipakai tombol "Contact us" di /auth & /profile, pengajuan
 * lupa password, dan tautan WhatsApp di halaman link publik.
 *
 * Dulu hardcode di lib/contact.ts (hanya bisa diganti lewat env + redeploy).
 */
function ContactSection({
  barId,
  initial,
}: {
  barId: string;
  initial: string | null;
}) {
  const [wa, setWa] = React.useState(initial ?? "");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await updateBarContact(barId, { contactWa: wa });
      if (!res.ok) {
        toast.error(res.error ?? "Failed to save");
        return;
      }
      toast.success("Contact number saved");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Customer service</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          WhatsApp number used by the &quot;Contact us&quot; buttons, password
          reset requests, and your public link page.
        </p>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex-1 min-w-[220px]">
          <span className="text-xs font-medium text-muted-foreground">
            WhatsApp number
          </span>
          <input
            type="text"
            value={wa}
            maxLength={30}
            onChange={(e) => setWa(e.target.value)}
            placeholder="081228814542"
            className="mt-1 w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
          />
          <span className="mt-1 block text-[10px] text-muted-foreground">
            Any common format works — spaces, dashes, +62, or a leading 0.
            Leave empty to use the default number.
          </span>
        </label>
        <Button
          type="button"
          variant="gold"
          size="sm"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

// ============================================================
// TAX & SERVICE CHARGE
// ============================================================

function ChargeSection({
  barId,
  initial,
}: {
  barId: string;
  initial: ChargeConfig;
}) {
  const [config, setConfig] = React.useState<ChargeConfig>(initial);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  function patch(p: Partial<ChargeConfig>) {
    setConfig((prev) => ({ ...prev, ...p }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateChargeConfig(barId, config);
      toast.success("Tax & service settings saved");
      setDirty(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  // Preview dari contoh subtotal 150.000.
  const preview = computeBillTotals(150000, config);

  return (
    <Card className="p-5">
      <div className="flex items-start gap-2 mb-4">
        <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Percent className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Tax &amp; Service Charge</h2>
          <p className="text-xs text-muted-foreground">
            Added on top of the bill subtotal. Toggle each component on/off —
            the wording on bills follows automatically.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Toggle per komponen — nilai % tetap tersimpan saat dimatikan;
            wording di transaksi mengikuti (Tax & Service / Tax / Service /
            tanpa baris). */}
        <div className="flex items-center justify-between gap-3">
          <ChargeToggle
            label="Tax (PB1/PPN)"
            enabled={config.taxEnabled !== false}
            onToggle={() => patch({ taxEnabled: config.taxEnabled === false })}
          />
        </div>
        {config.taxEnabled !== false && (
          <ConfigField
            label="Tax rate"
            hint="Percentage of the subtotal"
            value={config.taxPercent}
            unit="%"
            min={0}
            max={100}
            step={0.5}
            onChange={(v) => patch({ taxPercent: v })}
          />
        )}
        <div className="flex items-center justify-between gap-3">
          <ChargeToggle
            label="Service charge"
            enabled={config.serviceEnabled !== false}
            onToggle={() =>
              patch({ serviceEnabled: config.serviceEnabled === false })
            }
          />
        </div>
        {config.serviceEnabled !== false && (
          <ConfigField
            label="Service rate"
            hint="Percentage of the subtotal"
            value={config.servicePercent}
            unit="%"
            min={0}
            max={100}
            step={0.5}
            onChange={(v) => patch({ servicePercent: v })}
          />
        )}

        {/* Rounding mode */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label className="text-sm font-medium">Rounding</label>
            <span className="text-[10px] text-muted-foreground">
              how each tax/service value is rounded
            </span>
          </div>
          <Select
            value={config.rounding}
            onChange={(v) => patch({ rounding: v as RoundingMode })}
            options={[
              { value: "none", label: "None" },
              { value: "up", label: "Round up" },
              { value: "down", label: "Round down" },
            ]}
            ariaLabel="Rounding mode"
            className="w-40"
          />
        </div>
      </div>

      {/* Preview */}
      <div className="mt-4 rounded-md border border-border bg-muted/10 p-3 text-xs space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Preview (subtotal {formatIDR(150000)})
        </div>
        <PreviewRow label="Subtotal" value={preview.subtotal} />
        {preview.chargePercent > 0 && (
          <PreviewRow
            label={`${preview.chargeLabel} (${preview.chargePercent}%)`}
            value={preview.charge}
          />
        )}
        <PreviewRow label="Total" value={preview.total} bold />
      </div>

      <div className="mt-5 pt-4 border-t border-border flex items-center justify-end">
        <Button
          type="button"
          variant="gold"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}

function PreviewRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        bold && "font-semibold text-foreground pt-1 border-t border-border"
      )}
    >
      <span className={cn(!bold && "text-muted-foreground")}>{label}</span>
      <span className="tabular-nums">{formatIDR(value)}</span>
    </div>
  );
}

// ============================================================
// OPERATING HOURS
// ============================================================

function OperatingHoursSection({
  barId,
  initial,
}: {
  barId: string;
  initial: OperatingHours;
}) {
  const [hours, setHours] = React.useState<Record<DayKey, DayHours>>(() => {
    const out = {} as Record<DayKey, DayHours>;
    for (const day of DAY_KEYS) {
      out[day] = initial[day] ?? {
        open: "10:00",
        close: "23:00",
        closed: false,
      };
    }
    return out;
  });
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  function update(day: DayKey, patch: Partial<DayHours>) {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
    setDirty(true);
  }

  function applyToAll() {
    const monValue = hours.mon;
    setHours((prev) => {
      const next = { ...prev };
      for (const day of DAY_KEYS) {
        next[day] = { ...monValue };
      }
      return next;
    });
    setDirty(true);
    toast.success("Monday copied to all days");
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateOperatingHours(barId, hours);
      toast.success("Operating hours saved");
      setDirty(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Operating Hours</h2>
            <p className="text-xs text-muted-foreground">
              Set open & close times per day
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={applyToAll}
          className="text-xs"
        >
          Copy Monday to all
        </Button>
      </div>

      <div className="space-y-2">
        {DAY_KEYS.map((day) => (
          <DayRow
            key={day}
            day={day}
            value={hours[day]}
            onChange={(patch) => update(day, patch)}
          />
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-border flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Tip: for a closing time after midnight, write it like 02:00 (e.g.
          until early morning).
        </p>
        <Button
          type="button"
          variant="gold"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}

function DayRow({
  day,
  value,
  onChange,
}: {
  day: DayKey;
  value: DayHours;
  onChange: (patch: Partial<DayHours>) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 transition sm:flex-nowrap",
        value.closed
          ? "border-border bg-muted/30"
          : "border-border bg-muted/10"
      )}
    >
      {/* Hari — lebar tetap agar semua label sejajar (termasuk "Wednesday"). */}
      <div
        className={cn(
          "w-24 shrink-0 text-sm font-semibold",
          value.closed && "text-muted-foreground"
        )}
      >
        {DAY_LABELS[day]}
      </div>

      {/* Toggle Closed */}
      <label className="flex w-24 shrink-0 cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value.closed}
          onChange={(e) => onChange({ closed: e.target.checked })}
          className="h-4 w-4 accent-primary"
        />
        <span className={cn(value.closed && "font-medium text-foreground")}>
          Closed
        </span>
      </label>

      {/* Rentang jam — rata kanan, disembunyikan halus saat tutup */}
      <div
        className={cn(
          "ml-auto flex items-center gap-2 transition",
          value.closed && "pointer-events-none opacity-40"
        )}
      >
        <input
          type="time"
          value={value.open}
          onChange={(e) => onChange({ open: e.target.value })}
          disabled={value.closed}
          aria-label={`${DAY_LABELS[day]} open time`}
          className="h-9 w-[7.5rem] rounded-md border border-border bg-input px-2 text-center text-sm font-mono tabular-nums focus:border-primary focus:outline-none disabled:cursor-not-allowed"
        />
        <span className="text-xs text-muted-foreground">—</span>
        <input
          type="time"
          value={value.close}
          onChange={(e) => onChange({ close: e.target.value })}
          disabled={value.closed}
          aria-label={`${DAY_LABELS[day]} close time`}
          className="h-9 w-[7.5rem] rounded-md border border-border bg-input px-2 text-center text-sm font-mono tabular-nums focus:border-primary focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

// ============================================================
// RESERVATION
// ============================================================

function ReservationSection({
  barId,
  initial,
}: {
  barId: string;
  initial: ReservationConfig;
}) {
  const [config, setConfig] = React.useState<ReservationConfig>(initial);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  function patch(p: Partial<ReservationConfig>) {
    setConfig((prev) => ({ ...prev, ...p }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateReservationConfig(barId, config);
      toast.success("Reservation settings saved");
      setDirty(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-2 mb-4">
        <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
          <CalendarCheck className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Reservations</h2>
          <p className="text-xs text-muted-foreground">
            Rules for table bookings by customers
          </p>
        </div>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-muted/10 mb-4 cursor-pointer">
        <div>
          <div className="text-sm font-medium">Enable Reservations</div>
          <div className="text-[11px] text-muted-foreground">
            Customers can book a table in advance (for a specific date/time)
          </div>
        </div>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="h-5 w-5 accent-primary shrink-0"
        />
      </label>

      <div
        className={cn(
          "space-y-3",
          !config.enabled && "opacity-50 pointer-events-none"
        )}
      >
        <ConfigField
          label="Booking window"
          hint="How many days ahead customers can book"
          value={config.bookingWindowDays}
          unit="days"
          min={1}
          max={30}
          onChange={(v) => patch({ bookingWindowDays: v })}
        />
        <ConfigField
          label="Min. lead time"
          hint="Minimum minutes before the booking time"
          value={config.minLeadTimeMinutes}
          unit="minutes"
          min={0}
          max={1440}
          step={15}
          onChange={(v) => patch({ minLeadTimeMinutes: v })}
        />
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label className="text-sm font-medium">Slot interval</label>
            <span className="text-[10px] text-muted-foreground">
              spacing between booking time slots
            </span>
          </div>
          <Select
            value={String(config.slotIntervalMinutes)}
            onChange={(v) =>
              patch({
                slotIntervalMinutes: Number(v) as 15 | 30 | 60 | 120,
              })
            }
            options={[
              { value: "15", label: "15 min" },
              { value: "30", label: "30 min" },
              { value: "60", label: "60 min" },
              { value: "120", label: "120 min" },
            ]}
            ariaLabel="Slot interval"
            className="w-40"
          />
        </div>

        <ConfigField
          label="Minimum deposit"
          hint="Percentage of the initial bill, tax & service included. 0 = no deposit, 50 = pay half, 100 = pay in full to reserve."
          value={config.minDownPaymentPercent}
          unit="%"
          min={0}
          max={100}
          step={5}
          onChange={(v) => patch({ minDownPaymentPercent: v })}
        />

        <ConfigField
          label="Booking reminder"
          hint="Send guests a reminder this many minutes before their booking time, by push and in-app notification. 0 = no reminder."
          value={config.reminderMinutesBefore}
          unit="min"
          min={0}
          max={1440}
          step={5}
          onChange={(v) => patch({ reminderMinutesBefore: v })}
        />
      </div>

      <div className="mt-5 pt-4 border-t border-border flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {config.enabled
            ? "Customers can book via /reserve later."
            : "Reservations are off. Customers can only open-table walk-in."}
        </p>
        <Button
          type="button"
          variant="gold"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}

function ConfigField({
  label,
  hint,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  // Teks lokal supaya bisa dikosongkan saat mengetik (mis. hapus "0" dulu).
  const [text, setText] = React.useState(String(value));

  // Sinkron kalau value dari luar berubah (mis. reset). Pola sama dgn MoneyInput.
  React.useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(raw: string) {
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) {
      onChange(min); // kosong → min (biasanya 0)
      return;
    }
    onChange(Math.max(min, Math.min(max, n)));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(String(value))}
          min={min}
          max={max}
          step={step}
          className="w-24 h-9 px-3 bg-input border border-border rounded-md text-sm tabular-nums focus:outline-none focus:border-primary"
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

/** Switch aktif/nonaktif komponen charge — pola switch PrivacyToggleSection. */
function ChargeToggle({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {enabled ? "On, added to bills" : "Off, not charged"}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? `Turn off ${label}` : `Turn on ${label}`}
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          enabled ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "inline-flex h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            enabled ? "translate-x-[22px]" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
