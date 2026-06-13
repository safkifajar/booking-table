"use client";

import * as React from "react";
import { toast } from "sonner";
import { Clock, CalendarCheck, Loader2, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, getActionErrorMessage } from "@/lib/utils";
import {
  updateOperatingHours,
  updateReservationConfig,
} from "@/lib/settings-actions";
import {
  DAY_KEYS,
  DAY_LABELS,
  type BarSettings,
  type DayHours,
  type DayKey,
  type OperatingHours,
  type ReservationConfig,
} from "@/lib/settings-constants";

interface Props {
  barId: string;
  initial: BarSettings;
}

export function SettingsManager({ barId, initial }: Props) {
  return (
    <div className="space-y-6">
      <OperatingHoursSection barId={barId} initial={initial.operatingHours} />
      <ReservationSection barId={barId} initial={initial.reservationConfig} />
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
    toast.success("Senin di-copy ke semua hari");
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateOperatingHours(barId, hours);
      toast.success("Jam operasional disimpan");
      setDirty(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
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
            <h2 className="text-base font-semibold">Jam Operasional</h2>
            <p className="text-xs text-muted-foreground">
              Atur jam buka & tutup per hari
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
          Copy Senin ke semua
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
          Tip: jam tutup setelah tengah malam, tulis seperti 02:00 (misal sampai
          dini hari).
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
              Menyimpan...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Simpan
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
        "flex items-center gap-3 p-2.5 rounded-md border transition",
        value.closed
          ? "border-border bg-muted/30 opacity-60"
          : "border-border bg-muted/10"
      )}
    >
      <div className="w-16 text-sm font-medium shrink-0">{DAY_LABELS[day]}</div>

      <label className="flex items-center gap-1.5 text-xs cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={value.closed}
          onChange={(e) => onChange({ closed: e.target.checked })}
          className="h-3.5 w-3.5 accent-primary"
        />
        <span>Tutup</span>
      </label>

      <div className="flex items-center gap-1.5 flex-1 justify-end">
        <input
          type="time"
          value={value.open}
          onChange={(e) => onChange({ open: e.target.value })}
          disabled={value.closed}
          className="h-9 px-2 bg-input border border-border rounded-md text-sm font-mono focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="text-xs text-muted-foreground">—</span>
        <input
          type="time"
          value={value.close}
          onChange={(e) => onChange({ close: e.target.value })}
          disabled={value.closed}
          className="h-9 px-2 bg-input border border-border rounded-md text-sm font-mono focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
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
      toast.success("Konfigurasi reservasi disimpan");
      setDirty(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
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
          <h2 className="text-base font-semibold">Reservasi</h2>
          <p className="text-xs text-muted-foreground">
            Aturan booking meja oleh customer
          </p>
        </div>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-muted/10 mb-4 cursor-pointer">
        <div>
          <div className="text-sm font-medium">Aktifkan Reservasi</div>
          <div className="text-[11px] text-muted-foreground">
            Customer bisa book meja terlebih dulu (untuk tanggal/jam tertentu)
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
          hint="Berapa hari ke depan customer bisa book"
          value={config.bookingWindowDays}
          unit="hari"
          min={1}
          max={30}
          onChange={(v) => patch({ bookingWindowDays: v })}
        />
        <ConfigField
          label="Min. lead time"
          hint="Booking minimal berapa menit sebelum waktu booking"
          value={config.minLeadTimeMinutes}
          unit="menit"
          min={0}
          max={1440}
          step={15}
          onChange={(v) => patch({ minLeadTimeMinutes: v })}
        />
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label className="text-sm font-medium">Slot interval</label>
            <span className="text-[10px] text-muted-foreground">
              jarak antar slot waktu booking
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {([15, 30, 60, 120] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => patch({ slotIntervalMinutes: opt })}
                className={cn(
                  "px-3 py-2 rounded-md border text-sm font-medium transition",
                  config.slotIntervalMinutes === opt
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {opt} mnt
              </button>
            ))}
          </div>
        </div>

        <ConfigField
          label="Minimum DP"
          hint="DP yang wajib dibayar saat reservasi. 0 = tidak perlu DP."
          value={config.minDownPaymentAmount}
          unit="Rp"
          min={0}
          max={10_000_000}
          step={10_000}
          onChange={(v) => patch({ minDownPaymentAmount: v })}
        />
      </div>

      <div className="mt-5 pt-4 border-t border-border flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {config.enabled
            ? "Customer bisa booking lewat /reserve nanti."
            : "Fitur reservasi tidak aktif. Customer cuma bisa open-table walk-in."}
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
              Menyimpan...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Simpan
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
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(Math.max(min, Math.min(max, n)));
          }}
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
