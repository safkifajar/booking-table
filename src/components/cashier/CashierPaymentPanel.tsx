"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Wallet,
  CheckCircle2,
  Receipt,
  Lock,
  Loader2,
  Banknote,
  CreditCard,
  Smartphone,
  QrCode,
  X,
  ChevronRight,
  ChevronLeft,
  Calculator,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  cashierCreatePayment,
  cashierMarkPaymentPaid,
  cashierCancelPayment,
  cashierCloseSession,
  cashierCheckPaymentStatus,
  type CashierSessionDetail,
} from "@/lib/cashier-actions";
import { formatIDR, cn, getActionErrorMessage } from "@/lib/utils";
import type { PaymentMethod } from "@/types/db";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}
/** Tanggal+jam ringkas, mis. "28 Jun 2026 · 21:00". */
function fmtDateTime(iso: string): string {
  const tgl = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
  return `${tgl} · ${fmtTime(iso)}`;
}

const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    value: "cash",
    label: "Cash",
    icon: <Banknote className="h-4 w-4" />,
    description: "Pay with cash, automatic change calculator",
  },
  {
    value: "qris",
    label: "QRIS",
    icon: <QrCode className="h-4 w-4" />,
    description: "Scan QR code, connected to payment gateway",
  },
  {
    value: "card",
    label: "Card",
    icon: <CreditCard className="h-4 w-4" />,
    description: "Debit / Credit card via EDC",
  },
  {
    value: "gopay",
    label: "Gopay",
    icon: <Smartphone className="h-4 w-4" />,
    description: "Transfer via Gopay",
  },
  {
    value: "ovo",
    label: "OVO",
    icon: <Smartphone className="h-4 w-4" />,
    description: "Transfer via OVO",
  },
];

/**
 * Panel pembayaran cashier — dirender di dalam SessionView (tab Pay) saat viewer
 * adalah cashier. Menjaga full payment power (kalkulator kembalian cash, QRIS,
 * pilih payer, partial amount, mark-paid/cancel pending, tutup meja → receipt)
 * tanpa duplikasi kode. Berfokus PEMBAYARAN saja: tidak menampilkan host card
 * atau daftar bill (sudah ada di tab Table/Bill SessionView).
 */
export function CashierPaymentPanel({
  detail,
  barId,
}: {
  detail: CashierSessionDetail;
  barId: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [paymentModalOpen, setPaymentModalOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = React.useState<string | null>(null);
  const [closing, setClosing] = React.useState(false);

  // Realtime
  React.useEffect(() => {
    if (!barId) return;
    const es = new EventSource(`/api/realtime/session/${detail.session_id}`);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => router.refresh(), 400);
    };
    es.onerror = () => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] session disconnected`);
      }
    };
    return () => {
      es.close();
      if (debounce) clearTimeout(debounce);
    };
  }, [barId, detail.session_id, router]);

  const isPaid = detail.outstanding === 0 && detail.subtotal > 0;
  const isClosed = detail.status === "closed";

  async function handleMarkPaid(paymentId: string) {
    setMarkingPaid(paymentId);
    try {
      await cashierMarkPaymentPaid(paymentId);
      toast.success("Payment confirmed");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to confirm"));
    } finally {
      setMarkingPaid(null);
    }
  }

  async function handleCancelPayment(paymentId: string) {
    const ok = await confirm({
      title: "Cancel this payment?",
      description:
        "The payment will be marked as failed and won't count toward the total paid.",
      confirmText: "Cancel payment",
      cancelText: "Never mind",
      variant: "danger",
    });
    if (!ok) return;

    setCancelling(paymentId);
    try {
      await cashierCancelPayment(paymentId);
      toast.success("Payment cancelled");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel"));
    } finally {
      setCancelling(null);
    }
  }

  async function handleCloseSession() {
    const ok = await confirm({
      title: "Close table now?",
      description: isPaid
        ? "The table will be closed and the receipt will be shown."
        : "There's still an outstanding payment. Close the table anyway?",
      confirmText: "Close Table",
      cancelText: "Cancel",
      variant: isPaid ? "default" : "danger",
    });
    if (!ok) return;

    setClosing(true);
    try {
      await cashierCloseSession(detail.session_id);
      toast.success("Table closed");
      router.push(`/staff/cashier/${detail.session_id}/receipt`);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to close table"));
      setClosing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Payments history */}
      {detail.payments.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Payment History</h2>
          </div>
          <div className="divide-y divide-border">
            {detail.payments.map((p) => (
              <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium">{p.paid_by_name}</span>
                    <Badge
                      variant={
                        p.status === "paid"
                          ? "default"
                          : p.status === "pending"
                            ? "warning"
                            : "secondary"
                      }
                      className="text-[10px] px-1.5"
                    >
                      {p.status === "paid"
                        ? "Paid"
                        : p.status === "pending"
                          ? "Pending"
                          : p.status === "failed"
                            ? "Cancelled"
                            : p.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground capitalize">
                    {p.method.toUpperCase()}
                    {p.paid_at && (
                      <>
                        {" · "}
                        <span className="tabular-nums">{fmtDateTime(p.paid_at)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      p.status === "failed" && "line-through text-muted-foreground"
                    )}
                  >
                    {formatIDR(p.amount)}
                  </div>
                  {p.status === "pending" && !isClosed && (
                    <div className="flex gap-1 mt-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkPaid(p.id)}
                        disabled={markingPaid === p.id || cancelling === p.id}
                        className="h-7 text-[10px] text-emerald-400 hover:text-emerald-300 px-2"
                      >
                        {markingPaid === p.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Mark Paid"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancelPayment(p.id)}
                        disabled={cancelling === p.id || markingPaid === p.id}
                        className="h-7 text-[10px] text-red-400 hover:text-red-300 px-2"
                      >
                        {cancelling === p.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Cancel"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Bill totals ringkas */}
      <Card className="px-4 py-3 space-y-1.5 bg-muted/20">
        <Row label="Subtotal" value={formatIDR(detail.subtotal)} />
        <Row
          label="Paid"
          value={formatIDR(detail.paid_total)}
          valueClass="text-emerald-400"
        />
        <Row
          label="Outstanding"
          value={formatIDR(detail.outstanding)}
          valueClass={
            detail.outstanding > 0
              ? "text-amber-400 font-bold"
              : "text-emerald-400 font-bold"
          }
          big
        />
      </Card>

      {/* Action buttons — sesi belum tutup: Accept Payment + Close Table */}
      {!isClosed && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setPaymentModalOpen(true)}
            disabled={detail.subtotal === 0 || isPaid}
          >
            <Wallet className="h-4 w-4" />
            Accept Payment
          </Button>
          <Button
            variant="gold"
            size="lg"
            onClick={handleCloseSession}
            disabled={closing}
          >
            {closing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Closing...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                Close Table
              </>
            )}
          </Button>
        </div>
      )}

      {/* Sesi sudah closed TAPI masih ada sisa tagihan → tetap bisa lunasi. */}
      {isClosed && detail.outstanding > 0 && (
        <div className="space-y-2">
          <Button
            variant="gold"
            size="lg"
            className="w-full"
            onClick={() => setPaymentModalOpen(true)}
          >
            <Wallet className="h-4 w-4" />
            Accept Payment ({formatIDR(detail.outstanding)})
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full">
            <a href={`/staff/cashier/${detail.session_id}/receipt`}>
              <Receipt className="h-4 w-4" /> View Receipt
            </a>
          </Button>
        </div>
      )}

      {/* Sesi closed & lunas → cukup lihat receipt. */}
      {isClosed && detail.outstanding === 0 && (
        <Button asChild variant="outline" size="lg" className="w-full">
          <a href={`/staff/cashier/${detail.session_id}/receipt`}>
            <Receipt className="h-4 w-4" /> View Receipt
          </a>
        </Button>
      )}

      {/* Payment modal */}
      {paymentModalOpen && (
        <PaymentModal
          detail={detail}
          onClose={() => setPaymentModalOpen(false)}
          onSuccess={() => {
            setPaymentModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
  big,
}: {
  label: string;
  value: string;
  valueClass?: string;
  big?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        big ? "text-base pt-1.5 border-t border-border" : "text-xs"
      )}
    >
      <span className={cn("text-muted-foreground", big && "font-medium")}>
        {label}
      </span>
      <span className={cn("tabular-nums font-semibold", valueClass)}>
        {value}
      </span>
    </div>
  );
}

// ============================================================
// PAYMENT MODAL
// ============================================================

type PaymentStep = "method" | "amount" | "qris-display";

function PaymentModal({
  detail,
  onClose,
  onSuccess,
}: {
  detail: CashierSessionDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = React.useState<PaymentStep>("method");
  const [selectedMember, setSelectedMember] = React.useState<
    CashierSessionDetail["members"][number] | undefined
  >(() => {
    // Default: host
    return detail.members.find((m) => m.is_host) ?? detail.members[0];
  });
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [amount, setAmount] = React.useState(detail.outstanding);
  const [cashReceived, setCashReceived] = React.useState(detail.outstanding);
  const [loading, setLoading] = React.useState(false);
  const [qrPaymentId, setQrPaymentId] = React.useState<string | null>(null);
  const [qrString, setQrString] = React.useState<string | null>(null);
  // Data-URL gambar QR (di-generate dari qrString via lib qrcode).
  const [qrImage, setQrImage] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  // Generate gambar QR dari qrString (EMV QRIS asli dari Duitku).
  React.useEffect(() => {
    let cancelled = false;
    if (!qrString) {
      // Reset async supaya tak setState sinkron di badan effect.
      Promise.resolve().then(() => {
        if (!cancelled) setQrImage(null);
      });
      return () => {
        cancelled = true;
      };
    }
    import("qrcode").then((QR) => {
      QR.toDataURL(qrString, { width: 320, margin: 1 })
        .then((url: string) => {
          if (!cancelled) setQrImage(url);
        })
        .catch(() => {
          if (!cancelled) setQrImage(null);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [qrString]);

  // Auto-poll status tiap 5 detik saat QR tampil → tandai lunas begitu dibayar
  // (cadangan kalau callback telat). Berhenti saat modal ditutup.
  React.useEffect(() => {
    if (step !== "qris-display" || !qrPaymentId) return;
    const t = setInterval(() => {
      void cashierCheckPaymentStatus(qrPaymentId)
        .then((r) => {
          if (r.status === "paid") {
            toast.success("Payment received");
            onSuccess();
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, qrPaymentId]);

  async function handleCheckStatus() {
    if (!qrPaymentId) return;
    setChecking(true);
    try {
      const r = await cashierCheckPaymentStatus(qrPaymentId);
      if (r.status === "paid") {
        toast.success("Payment received");
        onSuccess();
      } else {
        toast.info("Not paid yet — ask the customer to complete the scan");
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to check status"));
    } finally {
      setChecking(false);
    }
  }

  if (detail.members.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <Card className="max-w-sm p-6 text-center">
          <p className="text-sm">
            No members joined. Can&apos;t accept payment.
          </p>
          <Button onClick={onClose} variant="outline" className="mt-3 w-full">
            Close
          </Button>
        </Card>
      </div>
    );
  }

  function selectMethod(m: PaymentMethod) {
    setMethod(m);
    if (m === "cash") {
      setStep("amount");
    } else {
      // Non-cash → langsung step amount (kalau qris/dll ada confirmation)
      setStep("amount");
    }
  }

  async function handleSubmit() {
    if (!selectedMember) return;
    if (amount <= 0) {
      toast.error("Amount must be > 0");
      return;
    }
    if (method === "cash" && cashReceived < amount) {
      toast.error("Received amount is less than the total");
      return;
    }

    setLoading(true);
    try {
      const result = await cashierCreatePayment({
        sessionId: detail.session_id,
        payerMemberId: selectedMember.member_id,
        amount,
        method,
        cashReceived: method === "cash" ? cashReceived : undefined,
      });

      // Kalau QRIS dan dapat qrString → tampilkan QR
      if (method === "qris" && result.qrString) {
        setQrPaymentId(result.paymentId);
        setQrString(result.qrString);
        setStep("qris-display");
        setLoading(false);
        return;
      }

      // Cash atau auto-paid method
      if (result.status === "paid") {
        const message =
          method === "cash" && result.change !== null
            ? `Payment complete. Change: ${formatIDR(result.change)}`
            : "Payment complete";
        toast.success(message);
      } else {
        toast.success("Payment created (pending confirmation)");
      }
      onSuccess();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to process payment"));
      setLoading(false);
    }
  }

  async function handleQrConfirm() {
    if (!qrPaymentId) return;
    setLoading(true);
    try {
      await cashierMarkPaymentPaid(qrPaymentId);
      toast.success("QRIS payment confirmed");
      onSuccess();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to confirm"));
      setLoading(false);
    }
  }

  async function handleQrCancel() {
    if (!qrPaymentId) return;
    setLoading(true);
    try {
      await cashierCancelPayment(qrPaymentId);
      toast.success("QRIS cancelled");
      onSuccess();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel"));
      setLoading(false);
    }
  }

  const methodMeta = PAYMENT_METHODS.find((m) => m.value === method);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-md my-auto max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border shrink-0">
          {/* Back ke pilih metode (hanya di step amount) — di header, rapi. */}
          {step === "amount" && (
            <button
              type="button"
              onClick={() => setStep("method")}
              disabled={loading}
              className="h-8 w-8 -ml-1.5 rounded-full flex items-center justify-center hover:bg-muted/60 shrink-0"
              aria-label="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="font-semibold flex-1">
            {step === "method" && "Select Payment"}
            {step === "amount" && methodMeta?.label}
            {step === "qris-display" && "Scan QRIS"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Step 1: Pilih method */}
          {step === "method" && (
            <>
              {/* Outstanding info */}
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-0.5">
                  Outstanding
                </div>
                <div className="text-2xl font-bold tabular-nums text-amber-400">
                  {formatIDR(detail.outstanding)}
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Payer
                </label>
                <Select
                  value={selectedMember?.member_id ?? ""}
                  onChange={(v) =>
                    setSelectedMember(
                      detail.members.find((m) => m.member_id === v)
                    )
                  }
                  options={detail.members.map((m) => ({
                    value: m.member_id,
                    label: `${m.display_name} ${m.is_host ? "(Host)" : ""}`,
                  }))}
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Payment Method
                </label>
                <div className="space-y-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => selectMethod(m.value)}
                      className="w-full flex items-center gap-3 p-3 rounded-md border border-border hover:border-primary/40 hover:bg-primary/[0.03] transition text-left group"
                    >
                      <span className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 text-primary">
                        {m.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{m.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {m.description}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Step 2: Amount input */}
          {step === "amount" && (
            <>
              <div className="rounded-md bg-primary/[0.05] border border-primary/20 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-primary mb-0.5 flex items-center justify-center gap-1.5">
                  {methodMeta?.icon}
                  {methodMeta?.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  Payer:{" "}
                  <strong className="text-foreground">
                    {selectedMember?.display_name}
                  </strong>
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Payment Amount
                </label>
                <MoneyInput value={amount} onChange={setAmount} max={detail.outstanding} />
                <div className="flex gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={() => setAmount(detail.outstanding)}
                    className="text-[10px] px-2 py-1 rounded-full bg-primary/15 text-primary hover:bg-primary/25"
                  >
                    Full {formatIDR(detail.outstanding)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmount(Math.round(detail.outstanding / 2))}
                    className="text-[10px] px-2 py-1 rounded-full bg-muted/40 text-muted-foreground hover:bg-muted/60"
                  >
                    50%
                  </button>
                </div>
              </div>

              {/* Cash specific: nominal terima + kembalian */}
              {method === "cash" && (
                <>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                      Amount Received
                    </label>
                    <MoneyInput value={cashReceived} onChange={setCashReceived} />
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {[50_000, 100_000, 200_000, 500_000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setCashReceived(preset)}
                          className="text-[10px] px-2 py-1 rounded-full bg-muted/40 text-muted-foreground hover:bg-muted/60 tabular-nums"
                        >
                          {formatIDR(preset)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "rounded-md p-3 text-center border",
                      cashReceived >= amount
                        ? "bg-emerald-500/10 border-emerald-500/30"
                        : "bg-red-500/10 border-red-500/30"
                    )}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center justify-center gap-1.5">
                      <Calculator className="h-3 w-3" />
                      {cashReceived >= amount ? "Change" : "Short"}
                    </div>
                    <div
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        cashReceived >= amount
                          ? "text-emerald-400"
                          : "text-red-400"
                      )}
                    >
                      {formatIDR(Math.abs(cashReceived - amount))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Step 3: QRIS display */}
          {step === "qris-display" && qrString && (
            <div className="space-y-3">
              <div className="rounded-md border border-primary/30 bg-primary/[0.03] p-4 text-center space-y-3">
                <div className="text-xs text-muted-foreground">
                  Customer scans the QR code to pay (QRIS)
                </div>
                {/* QR asli dari Duitku — render qrString jadi gambar QR. */}
                <div className="aspect-square max-w-[240px] mx-auto bg-white rounded-md p-3 flex items-center justify-center">
                  {qrImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrImage}
                      alt="QRIS payment code"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="text-zinc-500 flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="text-[10px]">Generating QR…</span>
                    </div>
                  )}
                </div>
                <div className="text-2xl font-bold tabular-nums text-primary">
                  {formatIDR(amount)}
                </div>
                <div className="text-[10px] text-muted-foreground italic">
                  Waiting for payment — updates automatically once paid.
                </div>
              </div>

              {/* Cek status manual (cadangan kalau callback telat). */}
              <Button
                variant="gold"
                size="lg"
                className="w-full"
                onClick={handleCheckStatus}
                disabled={checking || loading}
              >
                {checking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Check Payment Status
                  </>
                )}
              </Button>
              {/* Konfirmasi manual (mis. terlihat sudah lunas di app Duitku). */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={handleQrConfirm}
                disabled={loading || checking}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Mark as paid manually"
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-red-400 hover:text-red-300"
                onClick={handleQrCancel}
                disabled={loading || checking}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Cancel QRIS"
                )}
              </Button>
            </div>
          )}
        </div>

        {step !== "qris-display" && (
          <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
            {/* Confirm — tombol utama full-width (hanya di step amount). */}
            {step === "amount" && (
              <Button
                type="button"
                variant="gold"
                size="lg"
                className="w-full"
                onClick={handleSubmit}
                disabled={loading || amount <= 0}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm {formatIDR(amount)}
                  </>
                )}
              </Button>
            )}
            {/* Satu tombol sekunder: Cancel (tutup modal). */}
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Money input — format Indonesia friendly:
 * - Display dengan titik ribuan (mis. "365.000")
 * - Strip leading zeros otomatis (ketik "0400000" → display "400.000")
 * - Internal state tetap angka murni
 * - Inputmode numeric supaya HP keypad muncul numeric only
 */
function MoneyInput({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
}) {
  const [text, setText] = React.useState(formatNumber(value));
  // Sync from external value changes (mis. preset button clicked) tanpa effect:
  // simpan value sebelumnya, dan saat berubah dari luar → re-derive text
  // langsung saat render (pola resmi React "adjust state while rendering").
  const [prevValue, setPrevValue] = React.useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(formatNumber(value));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip non-digit characters (titik ribuan, koma, dst)
    const digitsOnly = e.target.value.replace(/\D/g, "");
    // Parse jadi number, fallback 0 kalau empty
    const num = digitsOnly === "" ? 0 : parseInt(digitsOnly, 10);
    // Cap di max kalau diset
    const capped = max !== undefined ? Math.min(num, max) : num;

    setText(digitsOnly === "" ? "" : formatNumber(capped));
    onChange(capped);
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    // Select all on focus supaya gampang ganti
    e.target.select();
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      className="w-full h-12 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 text-lg font-semibold tabular-nums"
    />
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return new Intl.NumberFormat("id-ID").format(n);
}
