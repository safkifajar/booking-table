"use client";

import * as React from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, MapPin, Clock, Users, Loader2 } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { fetchTransactionDetail } from "../actions";
import type { TransactionDetail } from "@/lib/admin";

interface Props {
  sessionId: string | null;
  onClose: () => void;
}

export function TransactionDetailDrawer({ sessionId, onClose }: Props) {
  const [data, setData] = React.useState<TransactionDetail | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!sessionId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetchTransactionDetail(sessionId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <Drawer
      open={sessionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent sizeClass="max-w-2xl">
        <DrawerHeader>
          <div className="flex items-center gap-3 pr-10">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-primary/70 mb-0.5">
                Invoice Detail
              </div>
              <DrawerTitle className="truncate">
                {data ? (data.title ?? "Open Table") : loading ? "Memuat..." : "Detail Transaksi"}
              </DrawerTitle>
            </div>
            {data && (
              <Badge variant="default" className="text-[10px] shrink-0">
                {data.table_label}
              </Badge>
            )}
          </div>
        </DrawerHeader>

        <DrawerBody>
          {loading && <DrawerLoading />}
          {!loading && !data && (
            <div className="text-center text-sm text-muted-foreground py-8">
              Detail transaksi tidak ditemukan.
            </div>
          )}
          {!loading && data && <DrawerContentDetail data={data} />}
        </DrawerBody>

        {data && (
          <DrawerFooter>
            <Button
              variant="gold"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" /> Print invoice
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2 text-sm">Memuat detail...</span>
      </div>
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function DrawerContentDetail({ data }: { data: TransactionDetail }) {
  const startedAt = new Date(data.started_at);
  const closedAt = data.closed_at ? new Date(data.closed_at) : null;
  const durationMin = closedAt
    ? Math.floor((closedAt.getTime() - startedAt.getTime()) / 60_000)
    : null;

  return (
    <div className="space-y-5">
      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <Meta label="Host" value={data.host_name} />
        <Meta
          label="Area"
          value={
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {data.area_name}
            </span>
          }
        />
        <Meta
          label="Mulai"
          value={startedAt.toLocaleString("id-ID", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        />
        <Meta
          label="Selesai"
          value={
            closedAt
              ? closedAt.toLocaleString("id-ID", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "—"
          }
        />
        <Meta
          label="Anggota"
          value={
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {data.member_count} orang
            </span>
          }
        />
        <Meta
          label="Durasi"
          value={
            durationMin !== null ? (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {durationMin}m
              </span>
            ) : (
              "—"
            )
          }
        />
      </div>

      {/* Vibe tags */}
      {data.vibe_tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.vibe_tags.map((v) => (
            <Badge key={v} variant="secondary" className="text-[10px]">
              {v}
            </Badge>
          ))}
        </div>
      )}

      {/* Items table */}
      <section className="border-t border-border pt-4">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Pesanan ({data.items.length} item)
        </h3>
        {data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Tidak ada item.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left py-2 w-12">Q#</th>
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2 w-10">Qty</th>
                <th className="text-right py-2 w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-border/40 align-top"
                >
                  <td className="py-2 text-[10px] text-muted-foreground tabular-nums">
                    {i.queue_number !== null
                      ? `#${String(i.queue_number).padStart(3, "0")}`
                      : "—"}
                  </td>
                  <td className="py-2">
                    <div className="font-medium text-sm">{i.menu_item_name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      by {i.added_by_name}
                      {i.notes && <> · {i.notes}</>}
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                  <td className="py-2 text-right tabular-nums font-semibold">
                    {formatIDR(i.quantity * i.unit_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Totals */}
      <section className="border-t border-border pt-4 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums font-semibold">
            {formatIDR(data.subtotal)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Terbayar</span>
          <span className="tabular-nums text-emerald-400">
            {formatIDR(data.total_paid)}
          </span>
        </div>
        {data.subtotal - data.total_paid > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sisa</span>
            <span className="tabular-nums text-amber-400">
              {formatIDR(data.subtotal - data.total_paid)}
            </span>
          </div>
        )}
        <div className="flex justify-between pt-2 mt-2 border-t border-border text-base">
          <span className="font-semibold">Total</span>
          <span className="font-bold text-primary tabular-nums">
            {formatIDR(data.subtotal)}
          </span>
        </div>
      </section>

      {/* Payments */}
      {data.payments.length > 0 && (
        <section className="border-t border-border pt-4">
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Pembayaran ({data.payments.length})
          </h3>
          <div className="space-y-1.5 text-xs">
            {data.payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>
                  {p.paid_by_name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {p.method.toUpperCase()} · {p.split_mode}
                  </span>
                </span>
                <span className="tabular-nums">
                  {formatIDR(p.amount)}
                  {p.status !== "paid" && (
                    <span className="ml-1 text-[10px] text-amber-400">
                      ({p.status})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
