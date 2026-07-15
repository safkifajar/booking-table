"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, QrCode, RefreshCw, UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIDR, getActionErrorMessage } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { PaymentSheet } from "@/components/session/PaymentSheet";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";
import { cashierCreatePayment } from "@/lib/cashier-actions";
import {
  payShare,
  createSplitBatch,
  cancelUnpaidOrder,
  regenerateMemberPayment,
  type OrderDetail,
} from "@/lib/actions";
import type { PayableMethod } from "@/types/db";
import { toast } from "sonner";

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/** Hitung sisa detik dari expiresAt ISO string (untuk countdown QRIS). */
function toExpirySeconds(expiresAt: string | null | undefined): number | undefined {
  if (!expiresAt) return undefined;
  return Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function OrderDetailView({ detail }: { detail: OrderDetail }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [paySheet, setPaySheet] = React.useState(false);
  const [backBusy, setBackBusy] = React.useState(false);

  // Back handler: kalau order MASIH UNPAID & belum ada pembayaran lunas, klik
  // "kembali" = konfirmasi batal. Jika ya → order + pembayaran pending dibatalkan.
  // Order yg sudah paid/closed → back biasa tanpa konfirmasi.
  const backHref = `/session/${detail.sessionId}`;
  // HANYA host (atau staff) yang boleh membatalkan order — order itu milik meja,
  // bukan milik anggota yang kebetulan membukanya. Anggota biasa & penonton
  // (viewOnly) cukup kembali tanpa konfirmasi apa pun.
  const canCancel =
    (detail.isHost || detail.isStaff) &&
    !detail.viewOnly &&
    detail.status === "unpaid" &&
    detail.paid === 0;
  async function handleBack() {
    if (!canCancel) {
      router.push(backHref);
      return;
    }
    const ok = await confirm({
      title: "Cancel this order?",
      description:
        "If you go back now, this new order and its payment will be cancelled.",
      confirmText: "Yes, cancel",
      cancelText: "Keep paying",
      variant: "danger",
    });
    if (!ok) return;
    setBackBusy(true);
    try {
      await cancelUnpaidOrder(detail.id);
      router.push(backHref);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel the order"));
      setBackBusy(false);
    }
  }
  // QR yang sedang ditampilkan (via QrisPaymentDialog — data seragam: ID, amount,
  // countdown, poll, cancel). Sama seperti tampilan QRIS di tempat lain.
  const [activeQr, setActiveQr] = React.useState<{
    paymentId: string;
    qrString: string;
    amount: number;
    expirySeconds?: number;
  } | null>(null);

  // Waktu sekarang (di-refresh tiap 10 dtk) utk cek expired di history tanpa
  // Date.now() saat render.
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => !cancelled && setNow(Date.now()));
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Single payment (treat/staff) → buat 1 payment → tampilkan QR inline.
  async function handleSingle(
    amount: number,
    method: PayableMethod,
    voucherCode?: string
  ) {
    try {
      const result = await payShare({
        sessionId: detail.sessionId,
        orderId: detail.id,
        amount,
        method,
        splitMode: "custom",
        voucherCode,
      });
      setPaySheet(false);
      if (result.qrString && result.status === "pending") {
        setActiveQr({
          paymentId: result.paymentId,
          qrString: result.qrString,
          amount,
          expirySeconds: toExpirySeconds(result.expiresAt),
        });
      } else {
        toast.success(result.status === "paid" ? "Payment successful" : "Payment is being processed");
      }
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Payment failed"));
    }
  }
  // Batch (bagi rata) → generate N QRIS (1 per anggota) → tampilkan QR host inline.
  async function handleBatch(mode: "equal", method: PayableMethod) {
    try {
      const { results } = await createSplitBatch({
        sessionId: detail.sessionId,
        orderId: detail.id,
        mode,
        method,
      });
      setPaySheet(false);
      const created = results.filter((r) => r.status === "pending" || r.status === "paid");
      const mine = created.find((r) => r.memberId === detail.myMemberId) ?? created[0];
      if (created.length > 0) {
        toast.success(`QRIS created for ${created.length} member${created.length > 1 ? "s" : ""}`);
        if (mine?.qrString && mine.paymentId) {
          setActiveQr({
            paymentId: mine.paymentId,
            qrString: mine.qrString,
            amount: mine.amount,
            expirySeconds: toExpirySeconds(mine.expiresAt),
          });
        }
      } else {
        toast.info("No QRIS created (already have active ones?)");
      }
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to create split"));
    }
  }

  // Host/staff: generate ULANG QRIS untuk anggota yg pembayarannya kadaluarsa/
  // gagal (telat bayar). Payment lama di-failed-kan, dibuat QRIS baru dgn
  // nominal sama, dan HANYA anggota itu yang dapat notifikasi.
  const [regenId, setRegenId] = React.useState<string | null>(null);
  async function handleRegenerate(paymentId: string, memberName: string) {
    setRegenId(paymentId);
    try {
      const res = await regenerateMemberPayment({ paymentId });
      toast.success(`New QRIS created for ${memberName}`);
      // Kalau yg di-regenerate kebetulan milik diri sendiri (host bayar sendiri),
      // langsung tampilkan QR-nya. Anggota lain membukanya lewat "Show QR".
      if (res.qrString) {
        const mineNow = detail.payments.find((p) => p.id === paymentId);
        if (mineNow && mineNow.paid_by_member_id === detail.myMemberId) {
          setActiveQr({
            paymentId: res.paymentId,
            qrString: res.qrString,
            amount: res.amount,
            expirySeconds: toExpirySeconds(res.expiresAt),
          });
        }
      }
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to create a new QRIS"));
    } finally {
      setRegenId(null);
    }
  }

  // Badge order berbasis SISA TAGIHAN, bukan status DB mentah.
  // orders.status='paid' sebenarnya berarti "order sudah MASUK (dapur)" — itu
  // terjadi begitu ADA pembayaran lunas (mis. DP / baru 1 orang bayar dari
  // split). Jadi status DB 'paid' TIDAK berarti lunas. Kalau masih ada sisa,
  // tampilkan "Unpaid". Konsisten dgn OrderStatusBadge di list order (tab Bill).
  const isClosedOrder = detail.status === "closed";
  const isFullyPaid = !isClosedOrder && detail.outstanding <= 0;
  const statusLabel = isClosedOrder
    ? "Closed"
    : isFullyPaid
      ? "Paid"
      : "Unpaid";

  return (
    <main className="min-h-dvh bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={backBusy}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted disabled:opacity-50"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold">Order Detail</h1>
      </div>

      <div className="mx-auto max-w-md px-4 py-5 space-y-4">
        {/* Order info */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm">#{detail.id.slice(0, 8).toUpperCase()}</span>
            <Badge
              variant={
                isFullyPaid ? "success" : isClosedOrder ? "secondary" : "warning"
              }
              className="text-[10px]"
            >
              {statusLabel}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {fmtTime(detail.paidAt ?? detail.createdAt)}
          </div>
        </Card>

        {/* Items */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">Items</h2>
          <div className="space-y-2.5 text-sm">
            {detail.items.map((i) => (
              <div key={i.id} className="flex items-center gap-2.5">
                {/* Foto menu. Ikon garpu-sendok = placeholder saat tak ada
                    gambar / masih loading (konsisten dgn komponen menu lain). */}
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted/40 flex items-center justify-center">
                  <UtensilsCrossed className="h-4 w-4 text-muted-foreground/40" />
                  {i.image_url && (
                    <Image
                      src={i.image_url}
                      alt={i.name}
                      width={40}
                      height={40}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </div>
                <span className="flex-1 min-w-0 text-muted-foreground truncate">
                  {i.quantity}× {i.name}
                  {i.added_by ? <span className="text-[10px]"> · {i.added_by}</span> : null}
                </span>
                {!detail.viewOnly && (
                  <span className="tabular-nums shrink-0">{formatIDR(i.quantity * i.unit_price)}</span>
                )}
              </div>
            ))}
          </div>
          {/* Rincian nominal disembunyikan utk penonton non-member. */}
          {!detail.viewOnly && (
            <div className="mt-3 space-y-1 border-t border-border pt-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatIDR(detail.subtotal)}</span>
              </div>
              {detail.chargePercent > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax &amp; Service ({detail.chargePercent}%)</span>
                  <span className="tabular-nums">{formatIDR(detail.charge)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold pt-1 border-t border-border">
                <span>Total</span>
                <span className="text-primary tabular-nums">{formatIDR(detail.total)}</span>
              </div>
              {detail.paid > 0 && detail.outstanding > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Remaining</span>
                  <span className="tabular-nums text-primary">{formatIDR(detail.outstanding)}</span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Pay button — customer/host/waiter (non-cashier). Kasir pakai box khusus. */}
        {detail.canPay && !detail.isCashier && (
          <Button variant="gold" size="lg" className="w-full" onClick={() => setPaySheet(true)}>
            Pay this order
          </Button>
        )}

        {/* Tombol bayar sengaja tak ada: sisa tagihan sudah "dipesan" QRIS
            anggota lain yang masih aktif. Bayar lagi = risiko lebih bayar.
            Jelaskan, jangan biarkan host bingung tombolnya hilang. */}
        {!detail.canPay &&
          !detail.isCashier &&
          !detail.viewOnly &&
          (detail.isHost || detail.isStaff) &&
          detail.outstanding > 0 && (
            <Card className="p-4 text-sm text-muted-foreground text-center">
              Waiting for the other members to pay their QRIS. You can issue a
              new QRIS below once theirs expires.
            </Card>
          )}

        {/* Kasir: terima pembayaran (QRIS / Cash + kembalian). */}
        {detail.canPay && detail.isCashier && (
          <CashierPayBox
            detail={detail}
            onQr={(qr) => setActiveQr(qr)}
            onDone={() => router.refresh()}
          />
        )}

        {/* Payment history */}
        {detail.payments.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-2">Payment history</h2>
            <div className="space-y-2">
              {detail.payments.map((p, idx) => {
                const expired =
                  p.status === "pending" && p.expires_at != null && now > 0 && new Date(p.expires_at).getTime() <= now;
                const canShowQr = p.status === "pending" && !expired && p.qr_string;
                // Tombol "New QRIS" HANYA di baris TERAKHIR milik anggota ini
                // (riwayat terurut kronologis). Tanpa ini, tiap percobaan yang
                // mati menyisakan tombolnya sendiri → menumpuk 3-4 tombol dan
                // host bisa menerbitkan QRIS beruntun.
                const isLatestOfMember = !detail.payments.some(
                  (q, j) => j > idx && q.paid_by_member_id === p.paid_by_member_id
                );
                // Pembayaran anggota ini MATI (QR kadaluarsa / gagal) & order
                // belum lunas → host/staff boleh terbitkan QRIS baru untuk dia.
                // DP dikecualikan: punya lifecycle booking sendiri (server juga
                // menolaknya), jadi jangan tampilkan tombol yang pasti gagal.
                const isDead = p.status === "failed" || expired;
                const canRegenerate =
                  (detail.isHost || detail.isStaff) &&
                  isDead &&
                  isLatestOfMember &&
                  !p.is_down_payment &&
                  detail.outstanding > 0;
                return (
                  <Card key={p.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{p.paid_by}</span>
                          <Badge variant={p.is_down_payment ? "default" : "secondary"} className="text-[9px] px-1">
                            {p.is_down_payment ? "DP" : "Bill"}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.method.toUpperCase()} · {fmtTime(p.paid_at ?? p.created_at)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-primary tabular-nums">{formatIDR(p.amount)}</div>
                        <Badge
                          variant={p.status === "paid" ? "success" : p.status === "pending" && !expired ? "warning" : "secondary"}
                          className="text-[10px]"
                        >
                          {p.status === "paid" ? "Paid" : expired ? "Cancelled" : p.status === "pending" ? "Pending" : "Cancelled"}
                        </Badge>
                      </div>
                    </div>
                    {canShowQr && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveQr({
                            paymentId: p.id,
                            qrString: p.qr_string!,
                            amount: p.amount,
                            expirySeconds: toExpirySeconds(p.expires_at),
                          })
                        }
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition"
                      >
                        <QrCode className="h-3.5 w-3.5" /> Show QR
                      </button>
                    )}
                    {canRegenerate && (
                      <button
                        type="button"
                        disabled={regenId === p.id}
                        onClick={() => handleRegenerate(p.id, p.paid_by)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${regenId === p.id ? "animate-spin" : ""}`}
                        />
                        {regenId === p.id ? "Creating…" : "New QRIS"}
                      </button>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {paySheet && (
        <PaymentSheet
          sessionId={detail.sessionId}
          membersCount={detail.membersCount}
          // Basis hitungan = SISA (outstanding), bukan total → bagi rata setelah
          // DP jadi benar (sisa ÷ anggota).
          remaining={detail.outstanding}
          payFullOnly={detail.isStaff && !detail.isHost}
          onClose={() => setPaySheet(false)}
          onSingle={handleSingle}
          onBatch={handleBatch}
        />
      )}

      {/* QRIS dialog — tampilan seragam: ID transaksi, nominal, countdown, poll,
          cancel. Sama seperti QRIS di flow lain. */}
      {activeQr && (
        <QrisPaymentDialog
          paymentId={activeQr.paymentId}
          qrString={activeQr.qrString}
          amount={activeQr.amount}
          expirySeconds={activeQr.expirySeconds}
          onPaid={() => {
            setActiveQr(null);
            router.refresh();
          }}
          onExpired={() => {
            setActiveQr(null);
            router.refresh();
          }}
          onCancelled={() => {
            setActiveQr(null);
            router.refresh();
          }}
          onClose={() => setActiveQr(null)}
        />
      )}
    </main>
  );
}

/**
 * Box kasir di halaman detail order: pilih payer + metode (QRIS/Cash). Cash →
 * input diterima + kembalian. Accept → cashierCreatePayment (QRIS mock/duitku
 * auto-handle; cash langsung paid). (PRD Multi-Order — fitur kasir di detail.)
 */
function CashierPayBox({
  detail,
  onQr,
  onDone,
}: {
  detail: OrderDetail;
  onQr: (qr: { paymentId: string; qrString: string; amount: number; expirySeconds?: number }) => void;
  onDone: () => void;
}) {
  const [payerId, setPayerId] = React.useState(detail.members[0]?.id ?? "");
  const [method, setMethod] = React.useState<"qris" | "cash">("qris");
  const [cashReceived, setCashReceived] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const amount = detail.outstanding;
  const received = parseInt(cashReceived || "0", 10) || 0;
  const change = method === "cash" ? Math.max(0, received - amount) : 0;
  const cashValid = method !== "cash" || received >= amount;

  async function accept() {
    if (!payerId) {
      toast.error("Select a payer");
      return;
    }
    setLoading(true);
    try {
      const result = await cashierCreatePayment({
        sessionId: detail.sessionId,
        orderId: detail.id,
        payerMemberId: payerId,
        amount,
        method,
        cashReceived: method === "cash" ? received : undefined,
      });
      if (result.qrString && result.status === "pending") {
        onQr({
          paymentId: result.paymentId,
          qrString: result.qrString,
          amount,
          expirySeconds: toExpirySeconds(result.expiresAt),
        });
      } else {
        toast.success(
          method === "cash" && change > 0
            ? `Paid — change ${formatIDR(change)}`
            : "Payment received"
        );
      }
      onDone();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to accept payment"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm font-semibold">Accept payment (cashier)</div>

      {/* Payer */}
      <div>
        <label className="text-xs text-muted-foreground">Payer</label>
        <select
          value={payerId}
          onChange={(e) => setPayerId(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {detail.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* Method */}
      <div className="flex gap-2">
        {(["qris", "cash"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={
              "flex-1 rounded-md border px-3 py-2 text-sm transition " +
              (method === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40")
            }
          >
            {m === "qris" ? "QRIS" : "Cash"}
          </button>
        ))}
      </div>

      {/* Cash received + change */}
      {method === "cash" && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Cash received</label>
          <input
            inputMode="numeric"
            value={cashReceived}
            onChange={(e) => setCashReceived(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={String(amount)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums"
          />
          {received > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Change</span>
              <span className={change >= 0 ? "text-emerald-400 tabular-nums" : "text-red-400 tabular-nums"}>
                {formatIDR(change)}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between text-sm pt-1 border-t border-border">
        <span className="text-muted-foreground">Amount due</span>
        <span className="font-semibold text-primary tabular-nums">{formatIDR(amount)}</span>
      </div>

      <Button variant="gold" size="lg" className="w-full" disabled={loading || !cashValid} onClick={accept}>
        {loading ? "Processing…" : method === "cash" ? "Accept cash" : "Generate QRIS"}
      </Button>
    </Card>
  );
}
