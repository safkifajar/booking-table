"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { QrCode, Check, X, ChevronRight } from "lucide-react";
import { formatIDR, cn } from "@/lib/utils";
import type { PaymentMethod, SplitMode } from "@/types/db";

interface OrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  added_by: { member_id: string };
}

/**
 * Bottom-sheet pemilihan pembayaran: pilih tipe (split/my-order/treat) + metode,
 * lalu generate. Dipanggil dari BillTab (tombol "Pay"). Setelah generate, caller
 * mengarahkan ke halaman detail transaksi.
 *
 * Dipecah dari SplitPayment (form-only; summary & riwayat kini di BillTab).
 */
export function PaymentSheet({
  items,
  membersCount,
  myMemberId,
  total,
  remaining,
  payFullOnly,
  onClose,
  onSingle,
  onBatch,
}: {
  items: OrderItem[];
  membersCount: number;
  myMemberId: string | null;
  total: number;
  remaining: number;
  /** Staff: terkunci ke "Pay in full" (custom). */
  payFullOnly?: boolean;
  onClose: () => void;
  /** custom/treat/staff → 1 payment. Return setelah generate (caller redirect). */
  onSingle: (amount: number, method: PaymentMethod) => Promise<void>;
  /** equal/itemized → batch. */
  onBatch: (mode: "equal" | "itemized", method: PaymentMethod) => Promise<void>;
}) {
  const [mode, setMode] = React.useState<SplitMode | "">(
    payFullOnly ? "custom" : ""
  );
  const [method, setMethod] = React.useState<PaymentMethod | "">("");
  const [loading, setLoading] = React.useState(false);
  const [typeSheet, setTypeSheet] = React.useState(false);
  const [methodSheet, setMethodSheet] = React.useState(false);

  const equalShare = membersCount > 0 ? Math.ceil(total / membersCount) : 0;
  const myItemsTotal = items
    .filter((i) => i.added_by.member_id === myMemberId)
    .reduce((acc, i) => acc + i.quantity * i.unit_price, 0);
  const treatAmount = remaining;

  const isBatchMode = (mode === "equal" || mode === "itemized") && !payFullOnly;
  const rawAmount =
    mode === "equal" ? equalShare : mode === "itemized" ? myItemsTotal : mode === "custom" ? treatAmount : 0;
  const myAmount = Math.min(rawAmount, remaining);

  async function handlePay() {
    if (!mode || !method) return;
    setLoading(true);
    try {
      if (isBatchMode) {
        await onBatch(mode as "equal" | "itemized", method);
      } else {
        if (myAmount <= 0) return;
        await onSingle(myAmount, method);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="text-sm font-semibold">Pay bill</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Payment type — hidden untuk staff (terkunci pay in full). */}
          {!payFullOnly && (
            <div>
              <h4 className="text-sm font-semibold">Payment type</h4>
              <p className="text-xs text-muted-foreground mb-2">Choose how to split the bill</p>
              <button
                type="button"
                onClick={() => setTypeSheet(true)}
                className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-3 text-left hover:border-primary/40 transition"
              >
                <div className="min-w-0">
                  {mode ? (
                    <>
                      <p className="text-sm font-medium">{splitModeLabel(mode)}</p>
                      <p className="text-xs text-muted-foreground truncate">{splitModeDesc(mode, equalShare)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Select payment type…</p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </div>
          )}

          {/* Preview */}
          {mode === "itemized" && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium mb-1">Your order</div>
              {myItemsTotal > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Your total</span>
                  <span className="text-primary font-semibold">{formatIDR(myItemsTotal)}</span>
                </div>
              ) : (
                <p className="text-muted-foreground">You haven&apos;t ordered anything yet.</p>
              )}
            </div>
          )}
          {mode === "equal" && (
            <div className="rounded-md border border-border p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">Per person</span>
              <span className="text-primary font-semibold">{formatIDR(equalShare)}</span>
            </div>
          )}
          {mode === "custom" && (
            <div className="rounded-md border border-border p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">{payFullOnly ? "Pay in full" : "Your treat (full bill)"}</span>
              <span className="text-primary font-semibold">{formatIDR(treatAmount)}</span>
            </div>
          )}

          {/* Method */}
          <div>
            <h4 className="text-sm font-semibold">Payment method</h4>
            <p className="text-xs text-muted-foreground mb-2">Choose how to pay</p>
            <button
              type="button"
              onClick={() => setMethodSheet(true)}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-3 text-left hover:border-primary/40 transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                {method ? (
                  <>
                    <QrCode className="h-5 w-5" />
                    <span className="text-sm font-medium">QRIS</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Select payment method…</span>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </div>

          <Button
            variant="gold"
            size="lg"
            className="w-full"
            disabled={loading || !mode || !method || (!isBatchMode && myAmount <= 0)}
            onClick={handlePay}
          >
            {loading
              ? "Processing…"
              : !mode
                ? "Select payment type"
                : !method
                  ? "Select payment method"
                  : isBatchMode
                    ? mode === "equal"
                      ? "Generate QRIS for everyone"
                      : "Generate QRIS per order"
                    : myAmount > 0
                      ? `Pay ${formatIDR(myAmount)}`
                      : "Nothing to pay"}
          </Button>
        </div>

        {/* Type picker */}
        {typeSheet && (
          <PickerOverlay title="Payment type" onClose={() => setTypeSheet(false)}>
            <PickerRow label="Split equally" desc={`${formatIDR(equalShare)}/person`} active={mode === "equal"} onClick={() => { setMode("equal"); setTypeSheet(false); }} />
            <PickerRow label="My order" desc="Pay for what I ordered" active={mode === "itemized"} onClick={() => { setMode("itemized"); setTypeSheet(false); }} />
            <PickerRow label="My treat" desc="Pay for everything" active={mode === "custom"} onClick={() => { setMode("custom"); setTypeSheet(false); }} />
          </PickerOverlay>
        )}
        {methodSheet && (
          <PickerOverlay title="Payment method" onClose={() => setMethodSheet(false)}>
            <PickerRow icon={<QrCode className="h-5 w-5" />} label="QRIS" active={method === "qris"} onClick={() => { setMethod("qris"); setMethodSheet(false); }} />
          </PickerOverlay>
        )}
      </div>
    </div>
  );
}

function splitModeLabel(mode: SplitMode): string {
  if (mode === "equal") return "Split equally";
  if (mode === "itemized") return "My order";
  if (mode === "custom") return "My treat";
  return mode;
}
function splitModeDesc(mode: SplitMode, equalShare: number): string {
  if (mode === "equal") return `${formatIDR(equalShare)}/person`;
  if (mode === "itemized") return "Pay for what I ordered";
  if (mode === "custom") return "Pay for everything";
  return "";
}

function PickerOverlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[70vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-2">{children}</div>
      </div>
    </div>
  );
}
function PickerRow({ icon, label, desc, active, onClick }: { icon?: React.ReactNode; label: string; desc?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left transition", active ? "bg-primary/10" : "hover:bg-muted/50")}>
      {icon && <span className="text-foreground shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {active && <Check className="h-4 w-4 text-primary shrink-0" />}
    </button>
  );
}
