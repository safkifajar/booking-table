"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Crown,
  History,
  Loader2,
  QrCode,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";
import { cn, formatIDR, getActionErrorMessage } from "@/lib/utils";
import {
  previewMembershipPurchase,
  purchaseMembership,
  checkMembershipPaymentStatus,
  cancelMembershipPayment,
  type MyMembershipTxRow,
  type PendingMembershipTx,
  type PurchasePreview,
} from "@/lib/membership-actions";
import type { MyVoucherRow } from "@/lib/member-voucher";
import type { MembershipLevelRow } from "@/lib/membership";

interface StatusInfo {
  key: "basic" | "premium" | "vip";
  name: string;
  expiresAt: string | null;
  expired: boolean;
}

const KEY_STYLE: Record<string, string> = {
  basic: "bg-muted text-muted-foreground border-border",
  premium: "bg-primary/15 text-primary border-primary/30",
  vip: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

const PERIOD_SUFFIX: Record<MembershipLevelRow["billing_period"], string> = {
  one_time: " · one-time, for life",
  monthly: " / month",
  yearly: " / year",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export function MembershipView({
  status,
  levels,
  transactions,
  pendingTx,
  vouchers,
}: {
  status: StatusInfo;
  levels: MembershipLevelRow[];
  transactions: MyMembershipTxRow[];
  pendingTx: PendingMembershipTx | null;
  vouchers: MyVoucherRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"plans" | "vouchers" | "history">(
    "plans"
  );
  const [buyTarget, setBuyTarget] = React.useState<MembershipLevelRow | null>(
    null
  );
  const [qr, setQr] = React.useState<{
    txId: string;
    qrString: string;
    amount: number;
    expirySeconds?: number;
  } | null>(
    // Transaksi pending dgn QR tersimpan → tawarkan lanjut bayar.
    null
  );

  const purchasable = levels.filter((l) => l.is_purchasable);

  return (
    <div className="space-y-5">
      {/* Status saat ini */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Your membership
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                KEY_STYLE[status.key]
              )}
            >
              <Crown className="h-3.5 w-3.5" />
              {status.name}
            </span>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {status.key === "basic" ? (
              status.expired ? (
                <span className="text-red-400">Membership expired</span>
              ) : (
                "Free plan"
              )
            ) : status.expiresAt ? (
              <>Active until {fmtDate(status.expiresAt)}</>
            ) : (
              "Active for life"
            )}
          </div>
        </div>
      </Card>

      {/* Lanjutkan pembayaran pending */}
      {pendingTx && pendingTx.qr_string && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-3">
            <QrCode className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              Waiting for payment — {pendingTx.level_name} (
              {formatIDR(pendingTx.amount)})
            </div>
            <Button
              size="sm"
              variant="gold"
              onClick={() =>
                setQr({
                  txId: pendingTx.id,
                  qrString: pendingTx.qr_string!,
                  amount: pendingTx.amount,
                  expirySeconds: pendingTx.qr_expiry_seconds ?? undefined,
                })
              }
            >
              Continue
            </Button>
          </div>
        </Card>
      )}

      {/* Tab */}
      <div className="flex gap-1 border-b border-border">
        {(
          [
            { key: "plans", label: "Plans" },
            {
              key: "vouchers",
              label: `Vouchers (${vouchers.filter((v) => v.status === "active").length})`,
            },
            { key: "history", label: `History (${transactions.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "plans" && (
        <div className="space-y-3">
          {/* Kartu basic sbg info gratis */}
          {levels
            .filter((l) => !l.is_purchasable)
            .map((l) => (
              <PlanCard
                key={l.key}
                level={l}
                isCurrent={status.key === l.key}
                cta={null}
              />
            ))}
          {purchasable.map((l) => {
            const isCurrent = status.key === l.key;
            const lifetimeCurrent = isCurrent && status.expiresAt == null;
            return (
              <PlanCard
                key={l.key}
                level={l}
                isCurrent={isCurrent}
                cta={
                  lifetimeCurrent
                    ? null
                    : {
                        label: isCurrent
                          ? "Renew"
                          : status.key === "basic"
                            ? `Get ${l.name}`
                            : "Switch",
                        onClick: () => setBuyTarget(l),
                      }
                }
              />
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            Higher tiers can see and connect with more members in Network,
            unlock more stories, and invite more people to their table.
            Friends always see each other, whatever the tier.
          </p>
        </div>
      )}

      {tab === "vouchers" &&
        (vouchers.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <Ticket className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No vouchers yet. You&apos;ll receive discount vouchers when your
              membership activates — use them when paying your table bill.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {vouchers.map((v) => (
              <VoucherCard key={v.id} voucher={v} />
            ))}
            <p className="text-[11px] text-muted-foreground">
              Show or enter the code when paying your table bill. Each voucher
              can be used once.
            </p>
          </div>
        ))}

      {tab === "history" &&
        (transactions.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <History className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No membership transactions yet.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {transactions.map((t) => (
              <div key={t.id} className="p-3 sm:p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{t.level_name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {t.kind === "admin_grant"
                        ? "Granted"
                        : t.kind === "renewal"
                          ? "Renewal"
                          : "Purchase"}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px]",
                        t.status === "paid"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : t.status === "pending"
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            : "bg-red-500/15 text-red-400 border-red-500/30"
                      )}
                    >
                      {t.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(t.created_at)}
                    {" · "}
                    {t.period_end
                      ? `until ${fmtDate(t.period_end)}`
                      : "lifetime"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold">
                    {formatIDR(t.amount)}
                  </div>
                  {t.tax_amount + t.service_amount > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      incl. tax &amp; service
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Card>
        ))}

      {/* Dialog beli */}
      {buyTarget && (
        <BuyDialog
          level={buyTarget}
          currentKey={status.key}
          onClose={() => setBuyTarget(null)}
          onQr={(q) => {
            setBuyTarget(null);
            setQr(q);
          }}
          onActivated={() => {
            setBuyTarget(null);
            toast.success("Membership activated!");
            router.refresh();
          }}
        />
      )}

      {/* Dialog QR — action membership disuntikkan (dialog sama dgn order) */}
      {qr && (
        <QrisPaymentDialog
          paymentId={qr.txId}
          qrString={qr.qrString}
          amount={qr.amount}
          expirySeconds={qr.expirySeconds}
          checkAction={checkMembershipPaymentStatus}
          cancelAction={cancelMembershipPayment}
          onPaid={() => {
            setQr(null);
            toast.success("Membership activated!");
            router.refresh();
          }}
          onExpired={() => {
            setQr(null);
            router.refresh();
          }}
          onCancelled={() => {
            setQr(null);
            router.refresh();
          }}
          onClose={() => setQr(null)}
        />
      )}
    </div>
  );
}

/* ---------- Kartu paket ---------- */

function PlanCard({
  level,
  isCurrent,
  cta,
}: {
  level: MembershipLevelRow;
  isCurrent: boolean;
  cta: { label: string; onClick: () => void } | null;
}) {
  return (
    <Card
      className={cn(
        "p-5",
        isCurrent && "border-primary/40",
        level.key === "vip" && "border-purple-500/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                KEY_STYLE[level.key]
              )}
            >
              <Crown className="h-3 w-3" />
              {level.name}
            </span>
            {isCurrent && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Check className="h-3 w-3" /> Current
              </Badge>
            )}
          </div>
          <div className="mt-2 text-lg font-bold">
            {level.price === 0 ? (
              "Free"
            ) : (
              <>
                {formatIDR(level.price)}
                <span className="text-xs font-normal text-muted-foreground">
                  {PERIOD_SUFFIX[level.billing_period]}
                </span>
              </>
            )}
          </div>
          {level.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {level.description}
            </p>
          )}
        </div>
        {cta && (
          <Button variant="gold" size="sm" onClick={cta.onClick} className="shrink-0">
            {cta.label}
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ---------- Kartu voucher benefit milik member ---------- */

function VoucherCard({ voucher }: { voucher: MyVoucherRow }) {
  const active = voucher.status === "active";
  const label =
    voucher.discount_type === "percent"
      ? `${voucher.discount_value}% off${voucher.max_discount ? ` (max ${formatIDR(voucher.max_discount)})` : ""}`
      : `${formatIDR(voucher.discount_value)} off`;
  return (
    <Card
      className={cn(
        "p-4",
        active ? "border-primary/30" : "opacity-60"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <Ticket className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">
              {voucher.name}
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {label}
            </Badge>
            {voucher.status !== "active" && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px]",
                  voucher.status === "used"
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : voucher.status === "reserved"
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-red-500/15 text-red-400 border-red-500/30"
                )}
              >
                {voucher.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {voucher.min_spend != null &&
              `Min. payment ${formatIDR(voucher.min_spend)} · `}
            valid until {fmtDate(voucher.expires_at)}
          </p>
        </div>
      </div>
      {/* Kode voucher — mudah disalin/ditunjukkan ke kasir */}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(voucher.code).then(
            () => toast.success("Code copied"),
            () => {}
          );
        }}
        disabled={!active}
        className={cn(
          "mt-3 w-full rounded-md border border-dashed px-3 py-2 font-mono text-sm tracking-widest text-center transition",
          active
            ? "border-primary/40 bg-primary/5 text-primary hover:border-primary/70"
            : "border-border text-muted-foreground line-through"
        )}
      >
        {voucher.code}
      </button>
    </Card>
  );
}

/* ---------- Dialog beli: ringkasan (tax & service) + bayar ---------- */

function BuyDialog({
  level,
  currentKey,
  onClose,
  onQr,
  onActivated,
}: {
  level: MembershipLevelRow;
  currentKey: string;
  onClose: () => void;
  onQr: (q: {
    txId: string;
    qrString: string;
    amount: number;
    expirySeconds?: number;
  }) => void;
  onActivated: () => void;
}) {
  const [preview, setPreview] = React.useState<PurchasePreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [paying, setPaying] = React.useState(false);

  // Ringkasan harga (base + tax & service) saat dialog dibuka.
  React.useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    previewMembershipPurchase({ levelKey: level.key })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled)
          setPreview({ ok: false, error: "Failed to load price" });
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [level.key]);

  async function handlePay() {
    if (!preview?.ok) return;
    setPaying(true);
    try {
      const res = await purchaseMembership({ levelKey: level.key });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.activated) {
        onActivated();
        return;
      }
      if (!res.qrString) {
        toast.error("Payment created but QR is missing — try again");
        return;
      }
      onQr({
        txId: res.txId,
        qrString: res.qrString,
        amount: res.amount,
        expirySeconds: res.qrExpirySeconds ?? undefined,
      });
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to start payment"));
    } finally {
      setPaying(false);
    }
  }

  const switching =
    preview?.ok && preview.replaces_active && currentKey !== level.key;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {currentKey === level.key ? "Renew" : "Get"} {level.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {previewing && (
            <div className="p-4 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          )}

          {/* Ringkasan: base + tax & service (config yang sama dgn bill F&B) */}
          {preview?.ok && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5 text-sm">
              <Row
                label={level.name}
                value={formatIDR(preview.base_amount ?? 0)}
              />
              {(preview.tax_amount ?? 0) + (preview.service_amount ?? 0) >
                0 && (
                <Row
                  label={`${preview.charge_label ?? "Tax & service"}${preview.charge_percent ? ` (${preview.charge_percent}%)` : ""}`}
                  value={formatIDR(
                    (preview.tax_amount ?? 0) + (preview.service_amount ?? 0)
                  )}
                />
              )}
              <div className="border-t border-border pt-1.5">
                <Row
                  label="Total"
                  value={formatIDR(preview.final_amount ?? 0)}
                  bold
                />
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                {preview.new_expires_at
                  ? `Active until ${fmtDate(preview.new_expires_at)}`
                  : "Active for life"}
                {preview.kind === "renewal" &&
                  " (extended from your current expiry)"}
              </p>
            </div>
          )}
          {preview && !preview.ok && (
            <p className="text-xs text-red-400">{preview.error}</p>
          )}

          {/* Peringatan ganti level (G5) */}
          {switching && (
            <p className="text-[11px] text-amber-400 rounded-md bg-amber-500/10 border border-amber-500/30 p-2.5">
              Switching plans starts a new period today — any remaining time on
              your current plan won&apos;t carry over.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="gold"
            disabled={paying || previewing || !preview?.ok}
            onClick={handlePay}
          >
            {paying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (preview?.ok ? (preview.final_amount ?? 0) : 1) <= 0 ? (
              "Activate free"
            ) : (
              <>
                <QrCode className="h-4 w-4" /> Pay with QRIS
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  bold,
  valueClass,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn("text-muted-foreground", bold && "text-foreground font-medium")}>
        {label}
      </span>
      <span className={cn(bold && "font-semibold", valueClass)}>{value}</span>
    </div>
  );
}
