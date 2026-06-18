"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Crown,
  Users,
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
  Calculator,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  cashierCreatePayment,
  cashierMarkPaymentPaid,
  cashierCancelPayment,
  cashierCloseSession,
  type CashierSessionDetail,
} from "@/lib/cashier-actions";
import { formatIDR, initials, cn, getActionErrorMessage } from "@/lib/utils";
import type { PaymentMethod } from "@/types/db";

interface Props {
  detail: CashierSessionDetail;
  barId: string;
}

const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    value: "cash",
    label: "Tunai",
    icon: <Banknote className="h-4 w-4" />,
    description: "Bayar pakai uang cash, kalkulator kembalian otomatis",
  },
  {
    value: "qris",
    label: "QRIS",
    icon: <QrCode className="h-4 w-4" />,
    description: "Scan QR code, terhubung ke payment gateway",
  },
  {
    value: "card",
    label: "Kartu",
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

export function CashierSessionDetailView({ detail, barId }: Props) {
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
    es.onmessage = () => router.refresh();
    es.onerror = () => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[realtime] session disconnected`);
      }
    };
    return () => es.close();
  }, [barId, detail.session_id, router]);

  const isPaid = detail.outstanding === 0 && detail.subtotal > 0;
  const isClosed = detail.status === "closed";

  async function handleMarkPaid(paymentId: string) {
    setMarkingPaid(paymentId);
    try {
      await cashierMarkPaymentPaid(paymentId);
      toast.success("Pembayaran dikonfirmasi");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal konfirmasi"));
    } finally {
      setMarkingPaid(null);
    }
  }

  async function handleCancelPayment(paymentId: string) {
    const ok = await confirm({
      title: "Batalkan pembayaran ini?",
      description: "Payment akan di-mark gagal dan tidak count ke total bayar.",
      confirmText: "Batalkan",
      cancelText: "Tidak jadi",
      variant: "danger",
    });
    if (!ok) return;

    setCancelling(paymentId);
    try {
      await cashierCancelPayment(paymentId);
      toast.success("Payment dibatalkan");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal batalkan"));
    } finally {
      setCancelling(null);
    }
  }

  async function handleCloseSession() {
    const ok = await confirm({
      title: "Tutup meja sekarang?",
      description: isPaid
        ? "Meja akan ditutup dan struk akan ditampilkan."
        : "Masih ada outstanding payment. Tetap tutup meja?",
      confirmText: "Tutup Meja",
      cancelText: "Batal",
      variant: isPaid ? "default" : "danger",
    });
    if (!ok) return;

    setClosing(true);
    try {
      await cashierCloseSession(detail.session_id);
      toast.success("Meja ditutup");
      router.push(`/staff/cashier/${detail.session_id}/receipt`);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal tutup meja"));
      setClosing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Status banner kalau closed */}
      {isClosed && (
        <Card className="p-4 bg-muted/40 border-muted-foreground/20 flex items-center gap-3">
          <Lock className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Meja sudah ditutup</div>
            <div className="text-xs text-muted-foreground">
              Tidak bisa terima pembayaran baru.
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={`/staff/cashier/${detail.session_id}/receipt`}>
              <Receipt className="h-3.5 w-3.5" /> Lihat Struk
            </a>
          </Button>
        </Card>
      )}

      {/* Host card */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 ring-2 ring-primary/20 shrink-0">
            {detail.host_avatar && (
              <AvatarImage src={detail.host_avatar} alt={detail.host_name} />
            )}
            <AvatarFallback>{initials(detail.host_name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary/70 mb-0.5">
              <Crown className="h-3 w-3" />
              {detail.is_walk_in ? "Tamu" : "Host"}
              {detail.is_walk_in && (
                <Badge
                  variant="default"
                  className="bg-primary/15 text-primary border-primary/30 text-[9px] px-1 gap-0.5 ml-1"
                >
                  Walk-in
                </Badge>
              )}
            </div>
            <div className="text-base font-semibold truncate">
              {detail.host_name}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {detail.title ?? "Open Table"}
            </div>
            {detail.is_walk_in && detail.opened_by_staff_name && (
              <div className="text-[10px] text-primary/70 truncate mt-0.5">
                Dibuka oleh {detail.opened_by_staff_name}
              </div>
            )}
            <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-0.5">
                <Users className="h-2.5 w-2.5" />
                {detail.members.length}/{detail.table_capacity}
              </span>
              <span>·</span>
              <RelativeTime
                date={detail.started_at}
                className="text-[11px]"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Bill items */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Bill Detail</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {detail.items.length} item
          </span>
        </div>
        {detail.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground italic">
            Belum ada order
          </div>
        ) : (
          <div className="divide-y divide-border">
            {detail.items.map((item) => (
              <div key={item.id} className="px-4 py-2.5 flex items-start gap-3">
                <div className="text-xs text-muted-foreground tabular-nums shrink-0 w-8">
                  {item.quantity}×
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {item.menu_item_name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    by {item.added_by_name}
                    {item.notes && ` · note: ${item.notes}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">
                    {formatIDR(item.quantity * item.unit_price)}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    @ {formatIDR(item.unit_price)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Totals */}
        <div className="px-4 py-3 border-t border-border space-y-1.5 bg-muted/20">
          <Row label="Subtotal" value={formatIDR(detail.subtotal)} />
          <Row
            label="Sudah dibayar"
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
        </div>
      </Card>

      {/* Payments history */}
      {detail.payments.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Riwayat Pembayaran</h2>
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
                        ? "Lunas"
                        : p.status === "pending"
                          ? "Pending"
                          : p.status === "failed"
                            ? "Dibatalkan"
                            : p.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground capitalize">
                    {p.method.toUpperCase()}
                    {p.paid_at && (
                      <>
                        {" · "}
                        <RelativeTime
                          date={p.paid_at}
                          className="text-[11px]"
                        />
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
                          "Tandai Lunas"
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
                          "Batal"
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

      {/* Action buttons */}
      {!isClosed && (
        <div className="grid grid-cols-2 gap-2 sticky bottom-0 bg-background/80 backdrop-blur-md py-3 -mx-4 px-4 border-t border-border">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setPaymentModalOpen(true)}
            disabled={detail.subtotal === 0 || isPaid}
          >
            <Wallet className="h-4 w-4" />
            Bayar
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
                Menutup...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                Tutup Meja
              </>
            )}
          </Button>
        </div>
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

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  if (detail.members.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <Card className="max-w-sm p-6 text-center">
          <p className="text-sm">
            Tidak ada member joined. Tidak bisa terima pembayaran.
          </p>
          <Button onClick={onClose} variant="outline" className="mt-3 w-full">
            Tutup
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
      toast.error("Nominal harus > 0");
      return;
    }
    if (method === "cash" && cashReceived < amount) {
      toast.error("Nominal terima kurang dari total");
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
            ? `Pembayaran lunas. Kembalian: ${formatIDR(result.change)}`
            : "Pembayaran lunas";
        toast.success(message);
      } else {
        toast.success("Payment dibuat (pending konfirmasi)");
      }
      onSuccess();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal proses pembayaran"));
      setLoading(false);
    }
  }

  async function handleQrConfirm() {
    if (!qrPaymentId) return;
    setLoading(true);
    try {
      await cashierMarkPaymentPaid(qrPaymentId);
      toast.success("Pembayaran QRIS dikonfirmasi");
      onSuccess();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal konfirmasi"));
      setLoading(false);
    }
  }

  async function handleQrCancel() {
    if (!qrPaymentId) return;
    setLoading(true);
    try {
      await cashierCancelPayment(qrPaymentId);
      toast.success("QRIS dibatalkan");
      onSuccess();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal batalkan"));
      setLoading(false);
    }
  }

  const methodMeta = PAYMENT_METHODS.find((m) => m.value === method);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-md my-auto max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold">
            {step === "method" && "Pilih Pembayaran"}
            {step === "amount" && methodMeta?.label}
            {step === "qris-display" && "Scan QRIS"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60"
            aria-label="Tutup"
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
                  Pembayar
                </label>
                <select
                  value={selectedMember?.member_id ?? ""}
                  onChange={(e) =>
                    setSelectedMember(
                      detail.members.find((m) => m.member_id === e.target.value)
                    )
                  }
                  className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
                >
                  {detail.members.map((m) => (
                    <option key={m.member_id} value={m.member_id}>
                      {m.display_name} {m.is_host && "(Host)"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Metode Pembayaran
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
                  Pembayar:{" "}
                  <strong className="text-foreground">
                    {selectedMember?.display_name}
                  </strong>
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Nominal Bayar
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
                      Nominal Diterima
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
                      {cashReceived >= amount ? "Kembalian" : "Kurang"}
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
                  Customer scan QR code untuk bayar
                </div>
                {/* QR placeholder — production akan render actual QR image */}
                <div className="aspect-square max-w-[240px] mx-auto bg-white rounded-md p-3 flex items-center justify-center">
                  <div className="text-center text-zinc-900 text-[10px] font-mono break-all">
                    <QrCode className="h-16 w-16 mx-auto mb-2" />
                    <div className="px-2">{qrString.slice(0, 50)}...</div>
                  </div>
                </div>
                <div className="text-2xl font-bold tabular-nums text-primary">
                  {formatIDR(amount)}
                </div>
                <div className="text-[10px] text-amber-400 italic">
                  ℹ️ Mock QR — production akan terhubung ke gateway
                </div>
              </div>

              <Button
                variant="gold"
                size="lg"
                className="w-full"
                onClick={handleQrConfirm}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Memproses...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Customer Sudah Bayar
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={handleQrCancel}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Batalkan QRIS"
                )}
              </Button>
            </div>
          )}
        </div>

        {step !== "qris-display" && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
            {step === "amount" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("method")}
                disabled={loading}
              >
                Kembali
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={loading}
            >
              Batal
            </Button>
            {step === "amount" && (
              <Button
                type="button"
                variant="gold"
                onClick={handleSubmit}
                disabled={loading || amount <= 0}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memproses...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Konfirmasi {formatIDR(amount)}
                  </>
                )}
              </Button>
            )}
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

  // Sync from external value changes (mis. preset button clicked)
  React.useEffect(() => {
    setText(formatNumber(value));
  }, [value]);

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
