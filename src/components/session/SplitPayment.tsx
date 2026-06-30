"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { QrCode, Wallet, CreditCard, Banknote, Check, Sparkles, CheckCircle2 } from "lucide-react";
import { formatIDR, initials, cn } from "@/lib/utils";
import type { PaymentMethod, SplitMode } from "@/types/db";

interface Member {
  id: string;
  profile: { id: string; display_name: string; avatar_url: string | null };
}

interface OrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  menu_item: { id: string; name: string };
  added_by: {
    member_id: string;
    profile_id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

interface Payment {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: string;
  split_mode: SplitMode;
  paid_at: string | null;
  paid_by: string;
  paid_by_avatar: string | null;
}

interface Props {
  sessionId: string;
  items: OrderItem[];
  payments: Payment[];
  members: Member[];
  myMemberId: string | null;
  subtotal: number;
  remaining: number;
  /** Waiter/staff: hanya boleh BAYAR PENUH (sembunyikan patungan & pesanan saya). */
  payFullOnly?: boolean;
  onPay: (input: {
    amount: number;
    method: PaymentMethod;
    splitMode: SplitMode;
    splitMeta?: Record<string, unknown>;
  }) => Promise<void>;
}

export function SplitPayment(props: Props) {
  // payFullOnly (staff) → default & terkunci ke "custom" (bayar penuh sisa).
  const [mode, setMode] = React.useState<SplitMode>(
    props.payFullOnly ? "custom" : "equal"
  );
  const [method, setMethod] = React.useState<PaymentMethod>("qris");
  const [loading, setLoading] = React.useState(false);

  // Equal: subtotal / members count
  const equalShare = props.members.length > 0
    ? Math.ceil(props.subtotal / props.members.length)
    : 0;

  // Itemized: total of items added by me
  const myItemsTotal = props.items
    .filter((i) => i.added_by.member_id === props.myMemberId)
    .reduce((acc, i) => acc + i.quantity * i.unit_price, 0);

  // Treat all: bayarin penuh sisa tagihan
  const treatAmount = props.remaining;

  // Cap ke remaining supaya tidak over-payment
  const rawAmount =
    mode === "equal"
      ? equalShare
      : mode === "itemized"
        ? myItemsTotal
        : mode === "custom"
          ? treatAmount
          : 0;
  const myAmount = Math.min(rawAmount, props.remaining);

  // Session sudah lunas kalau remaining 0 (atau di-overpaid jadi negative)
  const isFullyPaid = props.remaining <= 0 && props.subtotal > 0;

  async function handlePay() {
    if (myAmount <= 0 || isFullyPaid) return;
    setLoading(true);
    try {
      await props.onPay({
        amount: myAmount,
        method,
        splitMode: mode,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card className="p-5 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/30">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Total Bill
            </div>
            <div className="text-2xl font-bold text-gold-gradient">
              {formatIDR(props.subtotal)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {props.remaining <= 0 && props.subtotal > 0 ? "Status" : "Unpaid"}
            </div>
            <div
              className={cn(
                "text-lg font-semibold",
                props.remaining <= 0 && props.subtotal > 0
                  ? "text-emerald-400"
                  : "text-primary"
              )}
            >
              {props.remaining <= 0 && props.subtotal > 0
                ? "Paid"
                : formatIDR(props.remaining)}
            </div>
          </div>
        </div>
      </Card>

      {/* Sudah lunas banner */}
      {isFullyPaid && (
        <Card className="p-4 bg-emerald-500/10 border-emerald-500/30">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-emerald-400">
                Bill fully paid
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Total {formatIDR(props.subtotal)} has been paid in full. Wait for
                the cashier to close the table, or keep ordering if you want more.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Mode selector — hide kalau sudah lunas / waiter (payFullOnly) */}
      {!isFullyPaid && !props.payFullOnly && (
      <div>
        <h3 className="text-sm font-semibold mb-2">Payment method</h3>
        <div className="grid grid-cols-3 gap-2">
          <ModeOption
            label="Split equally"
            desc={`${formatIDR(equalShare)}/person`}
            active={mode === "equal"}
            onClick={() => setMode("equal")}
          />
          <ModeOption
            label="My order"
            desc="Pay for what I ordered"
            active={mode === "itemized"}
            onClick={() => setMode("itemized")}
          />
          <ModeOption
            label="My treat"
            desc="Pay for everything"
            active={mode === "custom"}
            onClick={() => setMode("custom")}
          />
        </div>
      </div>
      )}

      {/* Per-member share preview */}
      {!isFullyPaid && mode === "equal" && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Even split</h3>
          <div className="space-y-2">
            {props.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
                    <AvatarFallback className="text-[10px]">
                      {initials(m.profile.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{m.profile.display_name}</span>
                </div>
                <span className="text-sm font-medium">{formatIDR(equalShare)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!isFullyPaid && mode === "itemized" && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Pay for what you ordered</h3>
          {myItemsTotal > 0 ? (
            <div className="space-y-1.5 text-sm">
              {props.items
                .filter((i) => i.added_by.member_id === props.myMemberId)
                .map((i) => (
                  <div key={i.id} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {i.quantity}× {i.menu_item.name}
                    </span>
                    <span>{formatIDR(i.quantity * i.unit_price)}</span>
                  </div>
                ))}
              <div className="border-t border-border pt-1.5 mt-2 flex justify-between font-semibold">
                <span>Your total</span>
                <span className="text-primary">{formatIDR(myItemsTotal)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">You haven&apos;t ordered anything yet.</p>
          )}
        </Card>
      )}

      {!isFullyPaid && mode === "custom" && (
        <Card className="p-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/30">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            {props.payFullOnly ? "Pay in full" : "Your treat"}
          </h3>
          {treatAmount > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {props.payFullOnly
                  ? "The entire remaining table bill will be paid in full."
                  : "You'll pay the remaining bill in full. Other members don't need to pay."}
              </p>
              <div className="flex justify-between font-semibold pt-2 border-t border-border">
                <span>Total to pay</span>
                <span className="text-primary text-base">{formatIDR(treatAmount)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">The bill is fully paid.</p>
          )}
        </Card>
      )}

      {/* Payment method — hide kalau sudah lunas */}
      {!isFullyPaid && (
      <div>
        <h3 className="text-sm font-semibold mb-2">Payment method</h3>
        <div className="grid grid-cols-4 gap-2">
          <MethodOption
            icon={<QrCode className="h-5 w-5" />}
            label="QRIS"
            active={method === "qris"}
            onClick={() => setMethod("qris")}
          />
          <MethodOption
            icon={<Wallet className="h-5 w-5" />}
            label="GoPay"
            active={method === "gopay"}
            onClick={() => setMethod("gopay")}
          />
          <MethodOption
            icon={<CreditCard className="h-5 w-5" />}
            label="Card"
            active={method === "card"}
            onClick={() => setMethod("card")}
          />
          <MethodOption
            icon={<Banknote className="h-5 w-5" />}
            label="Cash"
            active={method === "cash"}
            onClick={() => setMethod("cash")}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 italic">
          * All methods are mocked for now. Midtrans/Xendit integration in the next milestone.
        </p>
      </div>
      )}

      {/* Pay button */}
      {!isFullyPaid && (
        <Button
          variant="gold"
          size="lg"
          className="w-full"
          disabled={loading || myAmount <= 0}
          onClick={handlePay}
        >
          {loading
            ? "Processing..."
            : myAmount > 0
              ? `Pay ${formatIDR(myAmount)}`
              : "Nothing to pay"}
        </Button>
      )}

      {/* Payment history */}
      {props.payments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 mt-6">Payments received</h3>
          <div className="space-y-2">
            {props.payments.map((p) => (
              <Card key={p.id} className="p-3 flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  {p.paid_by_avatar && <AvatarImage src={p.paid_by_avatar} />}
                  <AvatarFallback className="text-[10px]">
                    {initials(p.paid_by)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.paid_by}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.method.toUpperCase()} · {splitModeLabel(p.split_mode)}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-primary text-sm">
                    {formatIDR(p.amount)}
                  </div>
                  <Badge
                    variant={p.status === "paid" ? "success" : "warning"}
                    className="text-[10px]"
                  >
                    {p.status === "paid" && <Check className="h-2.5 w-2.5 mr-0.5" />}
                    {p.status}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function splitModeLabel(mode: SplitMode): string {
  if (mode === "equal") return "Split equally";
  if (mode === "itemized") return "Own order";
  if (mode === "custom") return "Treat";
  return mode;
}

function ModeOption({
  label,
  desc,
  active,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-3 rounded-md border text-center transition",
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-[10px] opacity-80 mt-0.5">{desc}</div>
    </button>
  );
}

function MethodOption({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 p-3 rounded-md border transition",
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
