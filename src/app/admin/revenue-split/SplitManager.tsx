"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn, formatIDR, getActionErrorMessage } from "@/lib/utils";
import {
  saveSplitScheme,
  runSplitBackfill,
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
  { value: "card", label: "Card" },
];

/** Seed 4 kategori (PRD) saat belum ada skema. */
const SEED: Row[] = [
  { name: "QRIS Mandiri", percent: "", method: "qris", sink: false },
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
  const confirm = useConfirm();
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
  const [effectiveAt, setEffectiveAt] = React.useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [note, setNote] = React.useState("");
  const [sample, setSample] = React.useState("100000");
  const [saving, setSaving] = React.useState(false);
  const [backfilling, setBackfilling] = React.useState(false);
  const [showVersions, setShowVersions] = React.useState(false);

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

  // Simulasi (logika sama dgn engine): basis = contoh subtotal.
  function simulate(method: string) {
    const base = Math.max(0, parseInt(sample, 10) || 0);
    const service = Math.round((base * servicePct) / 100);
    const out: { name: string; amount: number }[] = [];
    let allocated = 0;
    let sink: string | null = null;
    for (const r of rows) {
      if (r.sink) {
        sink = r.name || "Sink";
        continue;
      }
      if (r.method && r.method !== method) continue;
      const amount = Math.round((base * Math.round(parsePct(r.percent) * 1000)) / 100_000);
      out.push({ name: r.name || "—", amount });
      allocated += amount;
    }
    if (sink) out.push({ name: `${sink} (sink)`, amount: service - allocated });
    return { service, out };
  }

  async function handleSave() {
    const summary = rows
      .map((r) => `${r.name} ${r.percent || 0}%${r.method ? ` [${r.method}]` : ""}${r.sink ? " (sink)" : ""}`)
      .join("\n");
    const ok = await confirm({
      title: "Save as new version?",
      description: `Effective ${effectiveAt} — applies to payments PAID from that date. Old versions stay frozen.\n\n${summary}`,
      confirmText: "Save version",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await saveSplitScheme({
        effectiveAt,
        note: note.trim() || undefined,
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
      toast.success(`Scheme saved as version ${res.version}`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save scheme"));
    } finally {
      setSaving(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const { processed } = await runSplitBackfill();
      toast.success(`Backfill done — ${processed} source(s) processed`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Backfill failed"));
    } finally {
      setBackfilling(false);
    }
  }

  const simQris = simulate("qris");
  const simCash = simulate("cash");

  return (
    <div className="grid lg:grid-cols-5 gap-4 items-start">
      {/* FORM */}
      <Card className="lg:col-span-3 p-5 space-y-4">
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
              <button
                type="button"
                onClick={() => setSink(i)}
                title="Remainder sink — absorbs leftovers & rounding"
                className={cn(
                  "h-10 px-2.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider transition shrink-0",
                  r.sink
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/30"
                )}
              >
                Sink
              </button>
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

        <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Effective from
            </label>
            <input
              type="date"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowVersions((v) => !v)}>
              <History className="h-4 w-4" /> Versions ({config.versions.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={backfilling || config.versions.length === 0}
              onClick={handleBackfill}
            >
              {backfilling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Backfill
            </Button>
          </div>
          <Button variant="gold" disabled={saving || overBudget} onClick={handleSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save as new version
          </Button>
        </div>
        {overBudget && (
          <p className="text-xs text-red-400">
            Total {total.toFixed(3).replace(".", ",")}% exceeds the service
            charge ({servicePct}%) — reduce a category first.
          </p>
        )}

        {showVersions && (
          <div className="pt-2 border-t border-border space-y-2">
            {config.versions.map((v) => (
              <div key={v.version} className="text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    v{v.version}
                  </Badge>
                  <span className="text-muted-foreground">
                    effective {v.effective_at.slice(0, 10)}
                    {v.note && ` · ${v.note}`}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5">{v.summary}</p>
              </div>
            ))}
            {config.versions.length === 0 && (
              <p className="text-xs text-muted-foreground">No versions yet.</p>
            )}
          </div>
        )}
      </Card>

      {/* SIMULASI */}
      <Card className="lg:col-span-2 p-5 space-y-3">
        <h2 className="text-sm font-semibold">Live simulation</h2>
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Sample subtotal (IDR)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={sample}
            onChange={(e) => setSample(e.target.value.replace(/\D/g, ""))}
            className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm tabular-nums focus:outline-none focus:border-primary/60"
          />
        </div>
        {[
          { label: "QRIS payment", sim: simQris },
          { label: "Cash payment", sim: simCash },
        ].map(({ label, sim }) => (
          <div key={label} className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span className="font-medium">{label}</span>
              <span>service {formatIDR(sim.service)}</span>
            </div>
            {sim.out.map((r, i) => (
              <div key={i} className="flex justify-between">
                <span className="truncate">{r.name}</span>
                <span
                  className={cn("tabular-nums", r.amount < 0 && "text-red-400")}
                >
                  {formatIDR(r.amount)}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {formatIDR(sim.out.reduce((s, r) => s + r.amount, 0))}
              </span>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          Category rows bound to a method only apply to payments of that
          method; the sink absorbs whatever remains so the total always equals
          the service collected.
        </p>
      </Card>
    </div>
  );
}
