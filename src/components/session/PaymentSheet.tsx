"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { QrCode, Check, X, ChevronRight, Banknote } from "lucide-react";
import { formatIDR, cn } from "@/lib/utils";
import type { PayableMethod, SplitMode } from "@/types/db";
import { toast } from "sonner";
import { Loader2, Ticket } from "lucide-react";
import { previewBillVoucher } from "@/lib/membership-actions";

/**
 * Bottom-sheet pemilihan pembayaran: pilih tipe (bagi rata / traktir) + metode,
 * lalu generate. Dipanggil dari halaman detail order. Setelah generate, caller
 * mengarahkan ke QRIS/detail transaksi.
 *
 * Mode "my order" (itemized) DIHAPUS: sejak hanya HOST yang boleh menambah order,
 * semua item milik host → mode itu tak pernah masuk akal.
 */
export function PaymentSheet({
  membersCount,
  remaining,
  payFullOnly,
  sessionId,
  onClose,
  onSingle,
  onBatch,
}: {
  membersCount: number;
  /** Sisa yang harus dibayar (total − sudah dibayar). Basis semua hitungan. */
  remaining: number;
  /** Staff: terkunci ke "Pay in full" (custom). */
  payFullOnly?: boolean;
  /** Utk validasi voucher benefit membership (PRD Membership rev-2). */
  sessionId: string;
  onClose: () => void;
  /** custom/treat/staff → 1 payment. Return setelah generate (caller redirect). */
  onSingle: (
    amount: number,
    method: PayableMethod,
    voucherCode?: string
  ) => Promise<void>;
  /** equal → batch (1 QRIS per anggota, bagi rata dari sisa). */
  onBatch: (mode: "equal", method: PayableMethod) => Promise<void>;
}) {
  const [mode, setMode] = React.useState<SplitMode | "">(
    payFullOnly ? "custom" : ""
  );
  const [method, setMethod] = React.useState<PayableMethod | "">("");
  const [loading, setLoading] = React.useState(false);
  const [typeSheet, setTypeSheet] = React.useState(false);
  const [methodSheet, setMethodSheet] = React.useState(false);
  // Voucher benefit membership — hanya utk pembayaran TUNGGAL (custom/treat);
  // batch bagi-rata tidak mendukung voucher.
  const [voucherInput, setVoucherInput] = React.useState("");
  const [voucherChecking, setVoucherChecking] = React.useState(false);
  const [voucher, setVoucher] = React.useState<{
    code: string;
    name: string;
    discount: number;
  } | null>(null);

  // Bagi rata dihitung dari SISA (remaining), bukan total — supaya saat sudah ada
  // DP, yang dibagi adalah sisa utang bersama. Konsisten dgn server
  // (createSplitBatch). Contoh: total 100rb, DP 50rb lunas, 2 org → 25rb/orang.
  const equalShare = membersCount > 0 ? Math.ceil(remaining / membersCount) : 0;
  const treatAmount = remaining;

  const isBatchMode = mode === "equal" && !payFullOnly;
  const rawAmount =
    mode === "equal" ? equalShare : mode === "custom" ? treatAmount : 0;
  const myAmount = Math.min(rawAmount, remaining);

  async function handlePay() {
    if (!mode || !method) return;
    setLoading(true);
    try {
      if (isBatchMode) {
        await onBatch("equal", method);
      } else {
        if (myAmount <= 0) return;
        await onSingle(myAmount, method, voucher?.code);
      }
    } finally {
      setLoading(false);
    }
  }

  async function applyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code || myAmount <= 0) return;
    setVoucherChecking(true);
    try {
      const res = await previewBillVoucher({
        code,
        sessionId,
        amount: myAmount,
      });
      if (!res.ok) {
        setVoucher(null);
        toast.error(res.error);
        return;
      }
      setVoucher({ code: res.code, name: res.name, discount: res.discount });
      toast.success(`${res.name} applied`);
    } catch {
      toast.error("Failed to check voucher");
    } finally {
      setVoucherChecking(false);
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

          {/* Voucher membership — pembayaran tunggal saja (PRD Membership rev-2) */}
          {mode === "custom" && myAmount > 0 && (
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Ticket className="h-4 w-4 text-primary" /> Membership voucher
              </h4>
              <p className="text-xs text-muted-foreground mb-2">
                Have a voucher from your membership? Apply it here.
              </p>
              {voucher ? (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-primary truncate">
                      {voucher.name} ({voucher.code})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setVoucher(null);
                        setVoucherInput("");
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="text-emerald-400">
                      - {formatIDR(voucher.discount)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1">
                    <span className="text-muted-foreground">You&apos;ll pay</span>
                    <span className="font-semibold text-primary">
                      {formatIDR(Math.max(0, myAmount - voucher.discount))}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={voucherInput}
                    onChange={(e) =>
                      setVoucherInput(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "")
                      )
                    }
                    placeholder="e.g. SOHO-AB12-CD34"
                    className="flex-1 h-10 px-3 rounded-md bg-input border border-border text-sm font-mono focus:outline-none focus:border-primary/60"
                  />
                  <button
                    type="button"
                    onClick={applyVoucher}
                    disabled={voucherChecking || !voucherInput.trim()}
                    className="h-10 px-3.5 rounded-md border border-border text-sm hover:border-primary/40 transition disabled:opacity-50"
                  >
                    {voucherChecking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Apply"
                    )}
                  </button>
                </div>
              )}
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
                {method === "cash" ? (
                  <>
                    <Banknote className="h-5 w-5" />
                    <span className="text-sm font-medium">Pay at cashier</span>
                  </>
                ) : method ? (
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
                    ? method === "cash"
                      ? "Create cashier payments for everyone"
                      : "Generate QRIS for everyone"
                    : myAmount > 0
                      ? `Pay ${formatIDR(myAmount)}`
                      : "Nothing to pay"}
          </Button>
        </div>

        {/* Type picker */}
        {typeSheet && (
          <PickerOverlay title="Payment type" onClose={() => setTypeSheet(false)}>
            <PickerRow label="Split equally" desc={`${formatIDR(equalShare)}/person`} active={mode === "equal"} onClick={() => { setMode("equal"); setTypeSheet(false); }} />
            <PickerRow label="My treat" desc="Pay for everything" active={mode === "custom"} onClick={() => { setMode("custom"); setTypeSheet(false); }} />
          </PickerOverlay>
        )}
        {methodSheet && (
          <PickerOverlay title="Payment method" onClose={() => setMethodSheet(false)}>
            <PickerRow icon={<QrCode className="h-5 w-5" />} label="QRIS" active={method === "qris"} onClick={() => { setMethod("qris"); setMethodSheet(false); }} />
            <PickerRow
              icon={<Banknote className="h-5 w-5" />}
              label="Pay at cashier"
              desc="Confirm & pay at the cashier desk — order is sent once confirmed"
              active={method === "cash"}
              onClick={() => { setMethod("cash"); setMethodSheet(false); }}
            />
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
