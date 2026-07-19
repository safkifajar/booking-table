"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  Receipt,
  Banknote,
  CreditCard,
  Calendar,
  TrendingUp,
} from "lucide-react";
import { formatIDR, cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import type { ShiftSummary, ShiftTransaction } from "@/lib/cashier-actions";

interface Props {
  summary: ShiftSummary;
  transactions: ShiftTransaction[];
  defaultFromDate: string;
  defaultToDate: string;
}

export function ShiftReportView({
  summary,
  transactions,
  defaultFromDate,
  defaultToDate,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [from, setFrom] = React.useState(defaultFromDate);
  const [to, setTo] = React.useState(defaultToDate);

  function applyFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", from);
    params.set("to", to);
    router.push(`/staff/cashier/shift?${params.toString()}`);
  }

  type Preset = "today" | "yesterday" | "week";

  /** Rentang tanggal (WIB) untuk tiap preset — dipakai set & deteksi aktif. */
  const presetRange = React.useCallback((preset: Preset) => {
    const now = new Date();
    const TZ = 7;
    const nowJkt = new Date(now.getTime() + TZ * 3600 * 1000);
    const todayJkt = new Date(
      Date.UTC(
        nowJkt.getUTCFullYear(),
        nowJkt.getUTCMonth(),
        nowJkt.getUTCDate()
      )
    );
    const toDate = (d: Date) => d.toISOString().slice(0, 10);

    if (preset === "today") {
      const t = toDate(todayJkt);
      return { from: t, to: t };
    }
    if (preset === "yesterday") {
      const y = new Date(todayJkt);
      y.setUTCDate(y.getUTCDate() - 1);
      const t = toDate(y);
      return { from: t, to: t };
    }
    const start = new Date(todayJkt);
    start.setUTCDate(start.getUTCDate() - 6);
    return { from: toDate(start), to: toDate(todayJkt) };
  }, []);

  function setQuickRange(preset: Preset) {
    const r = presetRange(preset);
    setFrom(r.from);
    setTo(r.to);
  }

  /** Preset yang SEDANG cocok dgn rentang terpilih → chip-nya menyala.
   *  Dihitung dari nilai from/to (bukan disimpan terpisah) supaya tetap benar
   *  saat user mengubah tanggal manual lewat DatePicker. */
  const activePreset: Preset | null = React.useMemo(() => {
    for (const p of ["today", "yesterday", "week"] as const) {
      const r = presetRange(p);
      if (r.from === from && r.to === to) return p;
    }
    return null;
  }, [from, to, presetRange]);

  return (
    <div className="space-y-4">
      {/* Date filter */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-3">
          <Calendar className="h-3.5 w-3.5" />
          Filter Period
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">
              From
            </label>
            <DatePicker value={from} onChange={setFrom} />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">
              To
            </label>
            <DatePicker value={to} onChange={setTo} />
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <PresetChip
            label="Today"
            active={activePreset === "today"}
            onClick={() => setQuickRange("today")}
          />
          <PresetChip
            label="Yesterday"
            active={activePreset === "yesterday"}
            onClick={() => setQuickRange("yesterday")}
          />
          <PresetChip
            label="Last 7 days"
            active={activePreset === "week"}
            onClick={() => setQuickRange("week")}
          />
          <div className="flex-1" />
          <Button size="sm" variant="gold" onClick={applyFilter}>
            Apply
          </Button>
        </div>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryCard
          icon={<Receipt className="h-3.5 w-3.5" />}
          label="Transactions"
          value={summary.transaction_count.toString()}
        />
        <SummaryCard
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Total Revenue"
          value={formatIDR(summary.total_revenue)}
          tone="primary"
        />
        <SummaryCard
          icon={<Banknote className="h-3.5 w-3.5" />}
          label="Cash"
          value={formatIDR(summary.cash_revenue)}
        />
        <SummaryCard
          icon={<CreditCard className="h-3.5 w-3.5" />}
          label="Non-Cash"
          value={formatIDR(summary.noncash_revenue)}
        />
      </div>

      {/* Transactions table */}
      {transactions.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Wallet className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">No transactions</p>
          <p className="text-xs text-muted-foreground">
            No tables were closed in this period.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Table</th>
                  <th className="px-4 py-3 font-medium">Host</th>
                  <th className="px-4 py-3 font-medium text-right">Subtotal</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map((t) => {
                  const time = new Date(t.closed_at).toLocaleTimeString(
                    "en-US",
                    { hour: "2-digit", minute: "2-digit" }
                  );
                  const date = new Date(t.closed_at).toLocaleDateString(
                    "en-US",
                    { day: "2-digit", month: "short" }
                  );
                  return (
                    <tr key={t.session_id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-2.5">
                        <div className="text-sm font-medium">{time}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {date}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-sm font-medium">{t.table_label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {t.area_name}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">{t.host_name}</td>
                      <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                        {formatIDR(t.subtotal)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm tabular-nums font-semibold text-emerald-400">
                        {formatIDR(t.paid_total)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1 flex-wrap">
                          {t.payment_methods.map((m) => (
                            <span
                              key={m}
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full",
                                m === "cash"
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-primary/10 text-primary"
                              )}
                            >
                              {m.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                        >
                          <Link
                            href={`/staff/cashier/${t.session_id}/receipt`}
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Receipt
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "primary";
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "text-lg font-bold tabular-nums truncate",
          tone === "primary" && "text-primary"
        )}
      >
        {value}
      </div>
    </Card>
  );
}

/** Chip preset rentang tanggal — menyala saat rentangnya sedang dipakai. */
function PresetChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-[10px] px-2.5 py-1 rounded-full border transition",
        active
          ? "border-primary/50 bg-primary/15 text-primary font-medium"
          : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/60"
      )}
    >
      {label}
    </button>
  );
}
