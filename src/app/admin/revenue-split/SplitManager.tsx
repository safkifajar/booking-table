"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { cn, formatIDR, getActionErrorMessage } from "@/lib/utils";
import {
  saveSplitScheme,
  getLiveSplitRecap,
  type SplitConfigView,
} from "@/lib/revenue-split-actions";

interface Row {
  name: string;
  percent: string; // input desimal, koma/titik
  method: string; // "" = semua
  sink: boolean;
}

const METHOD_OPTIONS = [
  { value: "", label: "All methods" },
  { value: "qris", label: "QRIS" },
  { value: "cash", label: "Cash" },
];

/** Seed 4 kategori (PRD) saat belum ada skema. */
const SEED: Row[] = [
  { name: "QRIS", percent: "", method: "qris", sink: false },
  { name: "Outlet", percent: "", method: "", sink: false },
  { name: "Karyawan", percent: "", method: "", sink: false },
  { name: "IT/Kita", percent: "", method: "", sink: true },
];

function parsePct(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function SplitManager({ config }: { config: SplitConfigView }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>(() =>
    config.active
      ? config.active.categories.map((c) => ({
          name: c.name,
          percent: String(c.percent).replace(".", ","),
          method: c.method ?? "",
          sink: c.is_remainder_sink,
        }))
      : SEED
  );
  // Rekap rentang: default awal bulan berjalan s/d hari ini.
  const [rangeFrom, setRangeFrom] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [rangeTo, setRangeTo] = React.useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [rangeResult, setRangeResult] = React.useState<
    { category: string; total: number }[] | null
  >(null);
  const [rangeLoading, setRangeLoading] = React.useState(false);

  const loadRange = React.useCallback(
    async (from: string, to: string) => {
      setRangeLoading(true);
      try {
        const res = await getLiveSplitRecap({
          from,
          to,
          categories: rows.map((r) => ({
            name: r.name.trim() || "-",
            percent: parsePct(r.percent),
            method: r.method || null,
            isRemainderSink: r.sink,
          })),
        });
        setRangeResult(res.totals);
        exportRef.current = res;
      } catch {
        toast.error("Failed to load recap");
      } finally {
        setRangeLoading(false);
      }
    },
    [rows]
  );
  const exportRef = React.useRef<{
    totals: { category: string; total: number }[];
    rows: { paid_at: string; source: string; source_id: string; method: string; service: number; amounts: Record<string, number> }[];
  } | null>(null);

  const [saving, setSaving] = React.useState(false);

  const total = rows.reduce((s, r) => s + parsePct(r.percent), 0);
  const servicePct = config.service_enabled ? config.service_percent : 0;
  const remaining = servicePct - total;
  const overBudget = total > servicePct + 1e-9;

  function patch(i: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }
  function setSink(i: number) {
    setRows((prev) => prev.map((r, j) => ({ ...r, sink: j === i })));
  }

  // Simpan persentase saja (biar form tidak hilang saat reload), lalu
  // langsung tampilkan rekap rentang yang sedang di-set.
  async function handleSave() {
    setSaving(true);
    try {
      const d = new Date();
      const res = await saveSplitScheme({
        effectiveAt: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
        categories: rows.map((r) => ({
          name: r.name.trim(),
          percent: parsePct(r.percent),
          method: r.method || null,
          isRemainderSink: r.sink,
        })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Percentages saved");
      void loadRange(rangeFrom, rangeTo);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
    {/* FORM */}
    <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Service charge (Settings):{" "}
            <strong className={cn(!config.service_enabled && "text-red-400")}>
              {config.service_percent}%
              {!config.service_enabled && " (disabled!)"}
            </strong>
          </span>
          <span
            className={cn(
              "font-medium tabular-nums",
              overBudget ? "text-red-400" : "text-emerald-400"
            )}
          >
            Unallocated: {remaining.toFixed(3).replace(".", ",")}%
          </span>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={r.name}
                onChange={(e) => patch(i, { name: e.target.value })}
                placeholder="Category name"
                className="flex-1 h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 min-w-0"
              />
              <input
                type="text"
                inputMode="decimal"
                value={r.percent}
                onChange={(e) =>
                  patch(i, { percent: e.target.value.replace(/[^0-9.,]/g, "") })
                }
                placeholder="0,0"
                className="w-20 h-10 px-2 rounded-md bg-input border border-border text-sm text-right tabular-nums focus:outline-none focus:border-primary/60"
              />
              <span className="text-xs text-muted-foreground">%</span>
              <Select
                value={r.method}
                onChange={(v) => patch(i, { method: v })}
                options={METHOD_OPTIONS}
                className="w-32"
              />
              <label
                title="Remainder sink — absorbs leftovers & rounding"
                className="h-10 flex items-center gap-1.5 px-1.5 cursor-pointer select-none shrink-0"
              >
                <input
                  type="checkbox"
                  checked={r.sink}
                  onChange={() => setSink(i)}
                  className="h-4 w-4 accent-primary"
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider",
                    r.sink ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  Sink
                </span>
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove"
                disabled={rows.length <= 1}
                onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                className="text-red-400 shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((p) => [...p, { name: "", percent: "", method: "", sink: false }])
            }
          >
            <Plus className="h-4 w-4" /> Add category
          </Button>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div />
          <Button variant="gold" disabled={saving || overBudget} onClick={handleSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
        {/* Rekap RENTANG — nilai pembagian utk range yang di-set */}
        <div className="pt-3 border-t border-border space-y-2">
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Recap range
              </label>
              <div className="flex items-center gap-2">
                <DatePicker
                  value={rangeFrom}
                  max={rangeTo || undefined}
                  onChange={setRangeFrom}
                  ariaLabel="Recap from"
                  className="h-10 w-36"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <DatePicker
                  value={rangeTo}
                  min={rangeFrom || undefined}
                  onChange={setRangeTo}
                  ariaLabel="Recap to"
                  className="h-10 w-36"
                />
              </div>
            </div>
            <Button
              variant="outline"
              disabled={rangeLoading}
              onClick={() => void loadRange(rangeFrom, rangeTo)}
            >
              {rangeLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Show recap"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  if (!exportRef.current) await loadRange(rangeFrom, rangeTo);
                  const data = exportRef.current;
                  if (!data || data.rows.length === 0) {
                    toast.info("No transactions in this range");
                    return;
                  }
                  const cats = Array.from(
                    new Set(data.rows.flatMap((r) => Object.keys(r.amounts)))
                  );
                  const header = ["Paid at", "Source", "ID", "Method", "Service fee", ...cats, "Total"];
                  const lines = data.rows.map((r) => {
                    const vals = cats.map((c) => r.amounts[c] ?? 0);
                    return [
                      r.paid_at.slice(0, 16).replace("T", " "),
                      r.source,
                      r.source_id.slice(0, 8).toUpperCase(),
                      r.method,
                      r.service,
                      ...vals,
                      vals.reduce((s2, v) => s2 + v, 0),
                    ]
                      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                      .join(",");
                  });
                  const csv = [header.join(","), ...lines].join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `revenue-split_${rangeFrom}_${rangeTo}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  toast.error("Export failed");
                }
              }}
            >
              Export CSV
            </Button>
          </div>
          {rangeResult && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
              {rangeResult.length === 0 ? (
                <p className="text-muted-foreground col-span-full">
                  No split entries in this range.
                </p>
              ) : (
                rangeResult.map((r) => (
                  <div
                    key={r.category}
                    className="rounded bg-muted/20 border border-border/60 px-2.5 py-1.5 flex justify-between gap-2"
                  >
                    <span className="truncate text-muted-foreground">
                      {r.category}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums font-medium",
                        r.total < 0 && "text-red-400"
                      )}
                    >
                      {formatIDR(r.total)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {overBudget && (
          <p className="text-xs text-red-400">
            Total {total.toFixed(3).replace(".", ",")}% exceeds the service
            charge ({servicePct}%) — reduce a category first.
          </p>
        )}

      </Card>
    </div>
  );
}

