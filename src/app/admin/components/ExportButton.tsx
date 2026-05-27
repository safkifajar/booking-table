"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type Row = Record<string, string | number | null | undefined>;

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function ExportButton({
  filename,
  headers,
  rows,
  label = "Export CSV",
}: {
  filename: string;
  headers: string[];
  rows: Row[];
  label?: string;
}) {
  function download() {
    const keys = Object.keys(rows[0] ?? {});
    const csvHeaders = headers.length === keys.length ? headers : keys;
    const lines: string[] = [];
    lines.push(csvHeaders.map(escapeCsv).join(","));
    for (const row of rows) {
      lines.push(keys.map((k) => escapeCsv(row[k])).join(","));
    }
    // BOM for Excel UTF-8 compatibility
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={rows.length === 0}
    >
      <Download className="h-4 w-4" /> {label}
    </Button>
  );
}
