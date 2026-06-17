"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Users, Clock } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { TransactionDetailDrawer } from "./TransactionDetailDrawer";
import type { AdminTransaction } from "@/lib/admin";

export function TransactionsList({
  transactions,
}: {
  transactions: AdminTransaction[];
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  if (transactions.length === 0) return null;

  return (
    <>
      <Card className="overflow-hidden p-0">
        {/* Header row (desktop) */}
        <div className="hidden md:grid grid-cols-[100px_1fr_120px_140px_130px_30px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
          <span>Meja</span>
          <span>Detail</span>
          <span className="text-center">Pengunjung</span>
          <span>Waktu</span>
          <span className="text-right">Subtotal</span>
          <span></span>
        </div>

        <div className="divide-y divide-border">
          {transactions.map((t) => (
            <button
              key={t.session_id}
              type="button"
              onClick={() => setSelectedId(t.session_id)}
              className="w-full text-left group hover:bg-muted/30 transition"
            >
              {/* Desktop row */}
              <div className="hidden md:grid grid-cols-[100px_1fr_120px_140px_130px_30px] gap-3 px-4 py-3 items-center text-sm">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge variant="default" className="text-[10px]">
                    {t.table_label}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {t.area_name}
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="font-medium truncate text-sm">
                    {t.session_title ?? "Open Table"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Host: {t.host_name} · {t.item_count} items
                  </p>
                </div>

                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {t.member_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {t.duration_minutes}m
                  </span>
                </div>

                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {new Date(t.closed_at).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  <span className="block opacity-70">
                    {new Date(t.closed_at).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="text-right">
                  <div className="font-semibold text-primary tabular-nums">
                    {formatIDR(t.subtotal)}
                  </div>
                  {/* subtotal 0 = tak ada tagihan → jangan tampil "belum lunas" */}
                  {t.subtotal === 0 ? null : t.paid_total >= t.subtotal ? (
                    <Badge variant="success" className="mt-0.5 text-[9px] px-1.5">
                      Lunas
                    </Badge>
                  ) : (
                    <div className="mt-0.5">
                      <Badge variant="warning" className="text-[9px] px-1.5">
                        Belum lunas
                      </Badge>
                      <div className="text-[10px] text-amber-400 tabular-nums">
                        sisa {formatIDR(t.subtotal - t.paid_total)}
                      </div>
                    </div>
                  )}
                </div>

                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition" />
              </div>

              {/* Mobile card */}
              <div className="md:hidden p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="default" className="text-[10px]">
                      {t.table_label}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {t.area_name}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {new Date(t.closed_at).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-sm truncate">
                    {t.session_title ?? "Open Table"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Host: {t.host_name}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {t.member_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {t.duration_minutes}m
                    </span>
                    <span>{t.item_count} items</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-primary tabular-nums text-sm">
                      {formatIDR(t.subtotal)}
                    </div>
                    {t.subtotal === 0 ? null : t.paid_total >= t.subtotal ? (
                      <Badge variant="success" className="mt-0.5 text-[9px] px-1.5">
                        Lunas
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="mt-0.5 text-[9px] px-1.5">
                        Belum lunas · {formatIDR(t.subtotal - t.paid_total)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <TransactionDetailDrawer
        sessionId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
