"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminMembershipTxRow } from "@/lib/membership-actions";

/** Ekspor halaman transaksi membership yang sedang tampil ke CSV (Fase 5). */
export function ExportCsvButton({
  rows,
  page,
}: {
  rows: AdminMembershipTxRow[];
  page: number;
}) {
  function exportCsv() {
    const header = [
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
        new Date(r.created_at).toLocaleString("en-US"),
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
          ? new Date(r.period_end).toLocaleDateString("en-US")
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
    a.download = `membership-transactions-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
      <Download className="h-4 w-4" /> Export
    </Button>
  );
}
