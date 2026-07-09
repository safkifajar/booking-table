"use client";

import * as React from "react";
import Link from "next/link";
import { Printer, ArrowLeft, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/utils";
import type { CashierSessionDetail } from "@/lib/cashier-actions";

interface Props {
  detail: CashierSessionDetail;
}

/**
 * Receipt view + print.
 *
 * Layout 80mm thermal (~300px wide), monospace font. Container print
 * pakai CSS media query untuk hide non-receipt UI.
 *
 * Full thermal printer integration (ESC/POS via Web Bluetooth atau driver)
 * akan di-handle di task terpisah.
 */
export function ReceiptView({ detail }: Props) {
  function handlePrint() {
    window.print();
  }

  const date = new Date(
    detail.payments.find((p) => p.paid_at)?.paid_at ?? Date.now()
  );

  return (
    <div className="space-y-4">
      {/* Action buttons - hidden saat print */}
      <div className="flex gap-2 print:hidden">
        <Button onClick={handlePrint} variant="gold" size="lg" className="flex-1">
          <Printer className="h-4 w-4" />
          Print Receipt
        </Button>
        <Button asChild variant="outline" size="lg" className="flex-1">
          <Link href="/staff/cashier">
            <ArrowLeft className="h-4 w-4" />
            Done
          </Link>
        </Button>
      </div>

      {/* Receipt container — visually printable */}
      <Card
        className="mx-auto bg-white text-zinc-900 p-5 print:border-none print:shadow-none print:p-3"
        style={{ maxWidth: "320px", fontFamily: "ui-monospace, monospace" }}
      >
        {/* Header */}
        <div className="text-center border-b border-dashed border-zinc-300 pb-3 mb-3">
          <div className="flex items-center justify-center gap-1 text-xs uppercase tracking-widest text-zinc-600 mb-1">
            <Receipt className="h-3 w-3" />
            PAYMENT RECEIPT
          </div>
          <div className="text-base font-bold">SOHO Social House</div>
          <div className="text-[10px] text-zinc-600">Purwokerto</div>
        </div>

        {/* Meta */}
        <div className="space-y-0.5 text-[10px] mb-3 pb-3 border-b border-dashed border-zinc-300">
          <Row label="Table No." value={detail.table_label} />
          <Row label="Area" value={detail.area_name} />
          <Row
            label={detail.is_walk_in ? "Guest" : "Host"}
            value={detail.host_name}
          />
          {detail.is_walk_in && detail.guest_names.length > 1 && (
            <Row
              label="Other guests"
              value={detail.guest_names.slice(1).join(", ")}
            />
          )}
          {!detail.is_walk_in && detail.title && (
            <Row label="Session" value={detail.title} />
          )}
          {detail.is_walk_in && detail.opened_by_staff_name && (
            <Row label="Opened by" value={detail.opened_by_staff_name} />
          )}
          <Row label="Date" value={date.toLocaleString("en-US")} />
          <Row label="Trx No." value={`#${detail.session_id.slice(0, 8).toUpperCase()}`} />
        </div>

        {/* Walk-in badge */}
        {detail.is_walk_in && (
          <div className="text-center text-[9px] uppercase tracking-wider font-bold border border-dashed border-zinc-400 rounded py-1 mb-3 bg-zinc-50">
            * Walk-in *
          </div>
        )}

        {/* Items */}
        <div className="space-y-1 text-[10px] mb-3 pb-3 border-b border-dashed border-zinc-300">
          {detail.items.map((item) => (
            <div key={item.id}>
              <div className="flex justify-between gap-2">
                <span className="truncate">{item.menu_item_name}</span>
                <span className="tabular-nums shrink-0">
                  {formatIDR(item.quantity * item.unit_price)}
                </span>
              </div>
              <div className="text-zinc-600 text-[9px]">
                {item.quantity} × {formatIDR(item.unit_price)}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="space-y-1 text-[10px] mb-3">
          <Row label="Subtotal" value={formatIDR(detail.subtotal)} />
          {detail.charge_percent > 0 && (
            <Row
              label={`Tax & Service (${detail.charge_percent}%)`}
              value={formatIDR(detail.charge)}
            />
          )}
          <div className="border-t border-zinc-300 pt-1 mt-1">
            <Row
              label="TOTAL"
              value={formatIDR(detail.total)}
              bold
            />
          </div>
        </div>

        {/* Payments */}
        {detail.payments.filter((p) => p.status === "paid").length > 0 && (
          <div className="space-y-1 text-[10px] mb-3 pb-3 border-b border-dashed border-zinc-300">
            <div className="font-semibold text-center mb-1">PAYMENT</div>
            {detail.payments
              .filter((p) => p.status === "paid")
              .map((p) => (
                <Row
                  key={p.id}
                  label={`${p.method.toUpperCase()} (${p.paid_by_name})`}
                  value={formatIDR(p.amount)}
                />
              ))}
            <div className="border-t border-zinc-300 pt-1 mt-1">
              <Row
                label="PAID"
                value={formatIDR(detail.paid_total)}
                bold
              />
            </div>
            {detail.outstanding > 0 && (
              <Row
                label="OUTSTANDING"
                value={formatIDR(detail.outstanding)}
                bold
              />
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-[9px] text-zinc-600 space-y-0.5">
          <div>Thank you for visiting</div>
          <div>~ SOHO Social House ~</div>
        </div>
      </Card>

      {/* Hide everything except receipt for print */}
      <style jsx global>{`
        @media print {
          body {
            background: white;
          }
          @page {
            size: 80mm auto;
            margin: 5mm;
          }
        }
      `}</style>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}
    >
      <span className="truncate text-zinc-700">{label}</span>
      <span className="tabular-nums shrink-0">{value}</span>
    </div>
  );
}
