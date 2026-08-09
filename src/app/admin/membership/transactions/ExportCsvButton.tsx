"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminMembershipTxRow } from "@/lib/membership-actions";

/** Ekspor seluruh transaksi membership yang dimuat ke CSV (Fase 5). */
export function ExportCsvButton({ rows }: { rows: AdminMembershipTxRow[] }) {
  function exportCsv() {
    const header = [
      "ID",
      "Date",
      "Customer",
      "Email",
      "Level",
      "Kind",
      "Base",
      "Tax",
      "Service",
      "Total",
      "Status",
      "Period end",
    ];
    const lines = rows.map((r) =>
      [
        r.id.slice(0, 8).toUpperCase(),
        new Date(r.created_at).toLocaleString("en-GB", {
          dateStyle: "short",
          timeStyle: "short",
          hour12: false,
        }),
        r.customer_name,
        r.customer_email,
        r.level_name,
        r.kind,
        r.base_amount,
        r.tax_amount,
        r.service_amount,
        r.amount,
        r.status,
        r.period_end
          ? new Date(r.period_end).toLocaleDateString("en-GB")
          : "lifetime",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `membership-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
      <Download className="h-4 w-4" /> Export
    </Button>
  );
}
