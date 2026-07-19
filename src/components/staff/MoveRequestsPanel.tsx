"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  X,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  resolveMoveRequest,
  type MoveRequestRow,
} from "@/lib/move-approval-actions";
import { getActionErrorMessage, cn } from "@/lib/utils";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: {
      label: "Pending",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    },
    approved: {
      label: "Approved",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-red-500/15 text-red-300 border-red-500/30",
    },
    cancelled: {
      label: "Cancelled",
      cls: "bg-muted text-muted-foreground border-border",
    },
  };
  const s = map[status] ?? map.cancelled;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full border ${s.cls} shrink-0`}
    >
      {s.label}
    </span>
  );
}

/**
 * Daftar request pindah meja untuk staff (waiter/kasir) — konten tab "Pindah
 * Meja". Pending bisa di-approve/tolak; yg sudah diproses tetap tampil sbg
 * riwayat dgn badge status.
 */
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

export function MoveRequestsPanel({
  requests,
}: {
  requests: MoveRequestRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  // Filter (pola referensi user): chip BULAN + TAHUN + status.
  // Patokan tanggal = created_at (kapan request dibuat).
  // Default: BULAN & TAHUN SEKARANG (arahan user) — bukan "all".
  const now = React.useMemo(() => new Date(), []);
  const [month, setMonth] = React.useState<number>(now.getMonth());
  const [year, setYear] = React.useState<number | "all">(now.getFullYear());
  const [status, setStatus] = React.useState("all");

  // Auto-scroll strip bulan ke chip AKTIF saat pertama render — default =
  // bulan sekarang yang sering berada di luar layar (mis. Jul).
  const monthStripRef = React.useRef<HTMLDivElement>(null);
  const activeChipRef = React.useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => {
    const strip = monthStripRef.current;
    const chip = activeChipRef.current;
    if (!strip || !chip) return;
    // Scroll HANYA strip-nya (bukan halaman) — hitung offset manual supaya
    // scrollIntoView tak menggeser container induk.
    strip.scrollLeft =
      chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
    // Sekali saat mount: setelahnya user yang mengendalikan scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tahun yg ADA di data + tahun sekarang (supaya default selalu valid). */
  const years = React.useMemo(() => {
    const set = new Set<number>([now.getFullYear()]);
    for (const r of requests) {
      const d = new Date(r.created_at);
      if (!Number.isNaN(d.getTime())) set.add(d.getFullYear());
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [requests, now]);

  const filtered = React.useMemo(() => {
    return requests.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      const d = new Date(r.created_at);
      if (Number.isNaN(d.getTime())) return false;
      if (year !== "all" && d.getFullYear() !== year) return false;
      if (d.getMonth() !== month) return false;
      return true;
    });
  }, [requests, status, month, year]);

  // "Menyimpang dari default" = bukan bulan+tahun sekarang, atau status difilter.
  const hasFilter =
    month !== now.getMonth() ||
    year !== now.getFullYear() ||
    status !== "all";
  function resetFilter() {
    setMonth(now.getMonth());
    setYear(now.getFullYear());
    setStatus("all");
  }

  async function resolve(id: string, approve: boolean) {
    setBusy(id);
    try {
      await resolveMoveRequest({ requestId: id, approve });
      toast.success(approve ? "Table move approved" : "Request rejected");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to process"));
    } finally {
      setBusy(null);
    }
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No table move requests yet.
      </div>
    );
  }

  return (
    // space-y HANYA antar kartu request; header filter diberi margin bawah
    // sendiri supaya tak ada celah transparan di atas elemen sticky.
    <div className="[&>*+*]:mt-3">
      {/* Filter: STICKY saat scroll vertikal (arahan user) — menempel di atas
          area scroll (kasir & waiter sama-sama overflow-y-auto). Bleed ke tepi
          (-mx) + background solid supaya konten di bawahnya tak menembus. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-2 bg-background border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <div
            ref={monthStripRef}
            className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar"
          >
            {MONTH_LABELS.map((m, i) => (
              <FilterChip
                key={m}
                // Chip bulan AKTIF di-scroll ke tengah saat halaman dibuka
                // (default = bulan sekarang, sering di luar layar).
                ref={month === i ? activeChipRef : undefined}
                label={m}
                active={month === i}
                onClick={() => setMonth(i)}
              />
            ))}
          </div>

          {/* FIX (tak ikut scroll horizontal): status ikon, tahun angka. */}
          <div className="shrink-0 flex items-center gap-1.5">
            <StatusFilterButton value={status} onChange={setStatus} />
            <Select
              value={String(year)}
              onChange={(v) => setYear(v === "all" ? "all" : Number(v))}
              options={[
                { value: "all", label: "All" },
                ...years.map((y) => ({ value: String(y), label: String(y) })),
              ]}
              ariaLabel="Filter year"
              className="w-[86px]"
            />
          </div>
        </div>

        {/* Ringkasan selalu tampil: default kini SUDAH memfilter (bulan
            berjalan), jadi user perlu tahu berapa yg tersaring. */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {filtered.length} of {requests.length} request
            {requests.length === 1 ? "" : "s"}
          </span>
          {hasFilter && (
            <button
              type="button"
              onClick={resetFilter}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 hover:text-foreground hover:border-foreground/30 transition"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No requests match this filter.
        </div>
      ) : (
        filtered.map((r) => (
        <div
          key={r.id}
          className="rounded-lg border border-border bg-card p-3 flex items-center gap-3 flex-wrap"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">
                {r.requester_name}: Table {r.from_label} →{" "}
                <span className="text-primary">{r.to_label}</span>
              </p>
              <StatusBadge status={r.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {fmt(r.reservation_at)} – {fmt(r.reservation_end_at)}
            </p>
          </div>
          {r.status === "pending" && (
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="gold"
                disabled={busy === r.id}
                onClick={() => resolve(r.id, true)}
              >
                {busy === r.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === r.id}
                onClick={() => resolve(r.id, false)}
                className="text-red-400"
              >
                <X className="h-4 w-4" /> Reject
              </Button>
            </div>
          )}
        </div>
        ))
      )}
    </div>
  );
}

/**
 * Filter status berbentuk IKON saja (arahan user) — hemat ruang supaya
 * kontrol tetap muat tanpa scroll. Klik → menu pilihan status; ikon menyala
 * saat status difilter (bukan "all").
 */
function StatusFilterButton({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const active = value !== "all";

  // Klik di luar → tutup.
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current =
    STATUS_OPTIONS.find((o) => o.value === value)?.label ?? "All statuses";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Filter status: ${current}`}
        title={current}
        aria-pressed={active}
        className={cn(
          // h-11 = samakan dgn komponen Select (tahun) di sebelahnya.
          "h-11 w-11 inline-flex items-center justify-center rounded-md border transition",
          active
            ? "border-primary/50 bg-primary/15 text-primary"
            : "border-border bg-input text-muted-foreground hover:text-foreground"
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-2xl">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left rounded-md px-2.5 py-2 text-sm transition",
                o.value === value
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted/60"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chip filter bulan — menyala saat aktif. Ref diteruskan supaya chip aktif
 *  bisa di-scroll ke tengah strip saat mount. */
const FilterChip = React.forwardRef<
  HTMLButtonElement,
  { label: string; active: boolean; onClick: () => void }
>(function FilterChip({ label, active, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // Bentuk & tinggi DISAMAKAN dgn tombol status + Select tahun
        // (rounded-md, h-11) supaya satu baris terlihat seragam.
        "shrink-0 h-11 px-3.5 inline-flex items-center justify-center rounded-md border text-sm transition",
        active
          ? "border-primary/50 bg-primary/15 text-primary font-medium"
          : "border-border bg-input text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
});

/** Jumlah request pending (utk badge tab). */
export function countPending(requests: MoveRequestRow[]): number {
  return requests.filter((r) => r.status === "pending").length;
}

export { ArrowRightLeft as MoveIcon };
