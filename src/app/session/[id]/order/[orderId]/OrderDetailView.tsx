"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSessionRealtime } from "@/hooks/useSessionRealtime";
import Image from "next/image";
import {
  ArrowLeft,
  Banknote,
  QrCode,
  RefreshCw,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, formatIDR, getActionErrorMessage, initials } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { PaymentSheet } from "@/components/session/PaymentSheet";
import { QrisPaymentDialog } from "@/components/session/QrisPaymentDialog";
import { PayAtCashierCountdown } from "@/components/session/PayAtCashierCountdown";
import {
  cashierCreatePayment,
  cashierConfirmPendingPayment,
} from "@/lib/cashier-actions";
import { previewBillVoucher } from "@/lib/membership-actions";
import {
  payShare,
  createSplitBatch,
  cancelUnpaidOrder,
  cancelPayment,
  regenerateMemberPayment,
} from "@/lib/actions";
import type { OrderDetail } from "@/lib/order-types";
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
  // Halaman ini SEBELUMNYA tak punya realtime sama sekali, padahal isinya
  // berubah karena orang lain: anggota melunasi bagiannya (host harus
  // menunggu refresh manual untuk tahu), atau host membatalkan order
  // sementara anggota masih memegang QR terbuka — QR yang sudah tak berlaku
  // itu tetap terpampang dan bisa terlanjur dibayar.
  useSessionRealtime(detail.sessionId);
  const [paySheet, setPaySheet] = React.useState(false);
  const [backBusy, setBackBusy] = React.useState(false);

  // Back handler: kalau order MASIH UNPAID & belum ada pembayaran lunas, klik
  // "kembali" = konfirmasi batal. Jika ya → order + pembayaran pending dibatalkan.
  // Order yg sudah paid/closed → back biasa tanpa konfirmasi.
  // Kembali ke tab Bill — user datang dari list order di sana, jadi jangan
  // dilempar balik ke tab Vibe.
  const backHref = `/session/${detail.sessionId}?tab=bill`;
  // Popup batal saat menekan "kembali" HANYA untuk pemilik tagihan yang
  // customer, tak pernah untuk STAFF:
  // - Order MEJA (owner NULL)  → HOST saja. Kasir/waiter membuka halaman ini
  //   untuk MENERIMA PEMBAYARAN, bukan membatalkan — popup di tombol kembali
  //   jadi jebakan (salah pilih "Cancel order" = pesanan tamu hilang).
  //   Pembatalan yang memang disengaja oleh staff lewat force-close, bukan sini.
  // - Order milik ANGGOTA      → HANYA pemiliknya.
  // Penonton (viewOnly) & anggota lain cukup kembali tanpa konfirmasi.
  const canCancel =
    !detail.isStaff &&
    (detail.isOwnOrder
      ? true // pemilik order anggota
      : detail.isMemberOrder
        ? false // order milik anggota LAIN
        : detail.isHost) &&
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
        "This order and its pending payment will be cancelled and removed. This can't be undone.",
      // Wording tegas: tombol merah = benar-benar membatalkan; tombol netral =
      // tetap di halaman (jangan batal). Sebelumnya "Keep paying" ambigu.
      confirmText: "Cancel order",
      cancelText: "Keep order",
      variant: "danger",
    });
    if (!ok) return;
    setBackBusy(true);
    try {
      const res = await cancelUnpaidOrder(detail.id);
      // Kalau ini DP booking yang belum terkonfirmasi, seluruh booking ikut
      // batal (sesi cancelled) → JANGAN kembali ke halaman sesi (sudah mati);
      // keluar supaya tidak memantul & meja tidak tampak aktif.
      //
      // Staf pulang ke DASBORNYA, bukan "/": home itu aplikasi TAMU, yang
      // melempar ke /bar/[slug] lalu tertahan wizard onboarding — profil staf
      // memang tak pernah di-onboard, jadi waiter tersangkut di situ.
      if (res.bookingCancelled) {
        router.replace(detail.staffHome ?? "/");
        return;
      }
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
    /** Reference gateway (Duitku). Null = tak tersedia → tampilkan id kita. */
    reference?: string | null;
    qrString: string;
    amount: number;
    expirySeconds?: number;
  } | null>(null);

  /**
   * QR yang sudah TIDAK BERLAKU harus lenyap dari layar, bukan sekadar
   * berhenti diperbarui.
   *
   * Kalau host membatalkan order sementara anggota masih memegang dialog QR
   * terbuka, tanpa ini QR-nya tetap terpampang — dan anggota bisa terlanjur
   * memindainya lalu membayar tagihan yang sudah dibatalkan. Data segar
   * datang lewat SSE (useSessionRealtime di atas); yang tertinggal hanyalah
   * state klien ini.
   *
   * Diturunkan saat render, BUKAN lewat useEffect+setState — effect yang
   * memanggil setState memicu render berantai (dan aturan lint
   * react-hooks/set-state-in-effect).
   */
  const activeRow = activeQr
    ? detail.payments.find((p) => p.id === activeQr.paymentId)
    : undefined;
  // Hanya tutup kalau pembayarannya DIKENAL server dan sudah tak pending.
  // Baris yang belum dikenal berarti QR-nya baru saja dibuat dan data server
  // belum menyusul — menutupnya di situ justru melenyapkan QR yang sah.
  const activeQrDead =
    (activeRow != null && activeRow.status !== "pending") ||
    detail.status === "cancelled";
  const visibleQr = activeQr && !activeQrDead ? activeQr : null;

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
          reference: result.externalRef || null,
          qrString: result.qrString,
          amount,
          expirySeconds: toExpirySeconds(result.expiresAt),
        });
      } else if (method === "cash" && result.status === "pending") {
        // Pay at cashier: CUSTOMER → halaman tunggu (countdown 10 mnt). KASIR
        // (dirinya sendiri) → jangan ke layar tunggu; tetap di detail order &
        // konfirmasi via CashierConfirmBox.
        if (!detail.isCashier) {
          router.push(`/session/${detail.sessionId}/order/${detail.id}/pay`);
          return;
        }
        toast.success("Payment created. Confirm it below to complete");
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
            reference: mine.externalRef,
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
  // Batalkan pending "Pay at cashier" (customer berubah pikiran → bisa pilih
  // metode lain; slot outstanding-nya bebas lagi).
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  async function handleCancelCashierPayment(paymentId: string) {
    setCancellingId(paymentId);
    try {
      const res = await cancelPayment(paymentId);
      // Kalau ini DP booking → cancel membatalkan SELURUH booking (meja bebas
      // lagi). Jangan router.refresh() (guard akan memantulkan host balik ke
      // halaman tunggu → tampak "malah berhasil booking"); keluar dari sesi.
      if (res.bookingCancelled) {
        toast.success("Booking cancelled");
        // Sama seperti handleCancelOrder: staf pulang ke dasbornya, bukan ke
        // aplikasi tamu.
        router.replace(detail.staffHome ?? "/");
        return;
      }
      toast.success("Payment cancelled");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to cancel payment"));
    } finally {
      setCancellingId(null);
    }
  }
  // KASIR konfirmasi pending "Pay at cashier" LANGSUNG dari baris riwayat —
  // alur kasir memang lewat halaman ini (session → Bill → order), bukan
  // /staff/cashier/[sessionId]. Kasir PILIH metode aktual (arahan user):
  // cash → langsung lunas; QRIS → payment dikonversi jadi QR utk di-scan.
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  async function handleCashierConfirm(
    paymentId: string,
    method: "cash" | "qris",
    cashReceived?: number
  ) {
    setConfirmingId(paymentId);
    try {
      const res = await cashierConfirmPendingPayment({
        paymentId,
        method,
        cashReceived,
      });
      // Gagal validasi → pesan di res.error (pesan throw disensor Next.js
      // di produksi, jadi tak pernah sampai ke kasir).
      if (!res.ok) {
        toast.error(res.error ?? "Failed to confirm payment");
        // Tetap refresh: kegagalan spt "payment just changed state" justru
        // berarti data di layar sudah basi.
        router.refresh();
        return;
      }
      if (res.status === "paid") {
        toast.success(
          method === "cash" && res.change > 0
            ? `Payment confirmed. Change ${formatIDR(res.change)}`
            : "Payment confirmed. Order sent to the kitchen"
        );
      } else if (res.qrString) {
        // QRIS pending → tampilkan QR utk di-scan customer di meja kasir.
        setActiveQr({
          paymentId,
          reference: res.externalRef || null,
          qrString: res.qrString,
          amount: res.amount,
          expirySeconds: toExpirySeconds(res.expiresAt),
        });
      } else {
        toast.info("Payment is being processed");
      }
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to confirm payment"));
    } finally {
      setConfirmingId(null);
    }
  }
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
            reference: res.externalRef,
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
  // Potongan voucher membership (baris payments method='voucher' paid).
  // Di PEMBUKUAN tetap pembayaran (outstanding tertutup benar), tapi di
  // TAMPILAN disajikan sbg baris diskon di blok perhitungan — bukan di
  // riwayat pembayaran (membingungkan; feedback user).
  const voucherPaid = detail.payments
    .filter((p) => p.method === "voucher" && p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);
  const visiblePayments = detail.payments.filter((p) => p.method !== "voucher");
  // Ada pembayaran "Pay at cashier" yang masih menunggu konfirmasi? Kalau ya,
  // kasir HARUS mengonfirmasi baris itu (tombol Cash/QRIS di riwayat), BUKAN
  // membuat pembayaran baru lewat CashierPayBox — mencegah pembayaran dobel &
  // baris "Replaced" yang membingungkan.
  const hasPendingCashierPay = detail.payments.some(
    (p) => p.status === "pending" && p.pay_at_cashier
  );

  // 'cancelled' HARUS dicek paling awal: outstanding order batal = 0, jadi tanpa
  // ini ia salah tampil "Paid" — persis kebalikan kenyataannya.
  const isCancelledOrder = detail.status === "cancelled";
  const isClosedOrder = detail.status === "closed";
  const isFullyPaid =
    !isCancelledOrder && !isClosedOrder && detail.outstanding <= 0;
  const statusLabel = isCancelledOrder
    ? "Cancelled"
    : isClosedOrder
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
                isFullyPaid
                  ? "success"
                  : isCancelledOrder || isClosedOrder
                    ? "secondary"
                    : "warning"
              }
              className="text-[10px]"
            >
              {statusLabel}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {fmtTime(detail.paidAt ?? detail.createdAt)}
          </div>
          {/* Siapa yang memesan. Null utk view-only (di-redaksi server). */}
          {detail.ordered_by && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Ordered by{" "}
              <span className="text-foreground">{detail.ordered_by}</span>
              {detail.isOwnOrder && (
                <span className="text-primary"> · you pay this order</span>
              )}
            </div>
          )}
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
                  <span>{detail.chargeLabel} ({detail.chargePercent}%)</span>
                  <span className="tabular-nums">{formatIDR(detail.charge)}</span>
                </div>
              )}
              {voucherPaid > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Membership voucher</span>
                  <span className="tabular-nums">- {formatIDR(voucherPaid)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold pt-1 border-t border-border">
                <span>Total</span>
                <span className="text-primary tabular-nums">
                  {formatIDR(detail.total - voucherPaid)}
                </span>
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
          !hasPendingCashierPay &&
          (detail.isHost || detail.isStaff) &&
          detail.outstanding > 0 && (
            <Card className="p-4 text-sm text-muted-foreground text-center">
              Waiting for the other members to pay their QRIS. You can issue a
              new QRIS below once theirs expires.
            </Card>
          )}

        {/* Kasir: terima pembayaran (QRIS / Cash + kembalian). Disembunyikan
            saat ada pembayaran "Pay at cashier" pending — kasir konfirmasi
            baris itu (di riwayat) daripada membuat pembayaran paralel. */}
        {detail.canPay && detail.isCashier && !hasPendingCashierPay && (
          <CashierPayBox
            detail={detail}
            onQr={(qr) => setActiveQr(qr)}
            onDone={() => router.refresh()}
          />
        )}

        {/* Kasir: sorotan pembayaran "Pay at cashier" yang menunggu konfirmasi —
            arahkan ke baris di riwayat (tombol Cash/QRIS ada di sana). */}
        {detail.isCashier && hasPendingCashierPay && (
          <Card className="p-4 border-amber-500/30 bg-amber-500/[0.06]">
            <p className="text-sm font-medium text-amber-400">
              Customer chose to pay at the cashier
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Confirm the pending payment below (Cash or QRIS) once you receive
              the money — the order is sent to the kitchen right after.
            </p>
          </Card>
        )}

        {/* Payment history — baris voucher TIDAK ditampilkan di sini
            (sudah tampil sbg diskon di blok perhitungan). */}
        {visiblePayments.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-2">Payment history</h2>
            <div className="space-y-2">
              {visiblePayments.map((p, idx) => {
                const expired =
                  p.status === "pending" && p.expires_at != null && now > 0 && new Date(p.expires_at).getTime() <= now;
                const canShowQr = p.status === "pending" && !expired && p.qr_string;
                // Tombol "New QRIS" HANYA di baris TERAKHIR milik anggota ini
                // (riwayat terurut kronologis). Tanpa ini, tiap percobaan yang
                // mati menyisakan tombolnya sendiri → menumpuk 3-4 tombol dan
                // host bisa menerbitkan QRIS beruntun.
                const isLatestOfMember = !visiblePayments.some(
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
                  // Pay-at-cashier bukan QRIS — regenerate QR tak berlaku.
                  !p.pay_at_cashier &&
                  detail.outstanding > 0;
                return (
                  <Card key={p.id} className="p-3">
                    <div className="flex items-center gap-3">
                      {/* Foto pembayar */}
                      <Avatar className="h-9 w-9 shrink-0">
                        {p.paid_by_avatar && (
                          <AvatarImage src={p.paid_by_avatar} alt={p.paid_by} />
                        )}
                        <AvatarFallback className="text-xs">
                          {initials(p.paid_by)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate">{p.paid_by}</span>
                          {p.paid_by_is_host && (
                            <Badge variant="outline" className="text-[9px] px-1 text-primary border-primary/40">
                              host
                            </Badge>
                          )}
                          <Badge variant={p.is_down_payment ? "default" : "secondary"} className="text-[9px] px-1">
                            {p.is_down_payment ? "DP" : "Bill"}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {/* "PAY AT CASHIER" hanya relevan selagi MENUNGGU
                              konfirmasi. Begitu lunas, yang perlu diketahui
                              adalah metode yang BENAR-BENAR dipakai (QRIS/cash)
                              — juga menutup baris lama yg flag-nya terlanjur
                              menempel sebelum perbaikan di cashier-actions. */}
                          {p.pay_at_cashier && p.status === "pending"
                            ? "PAY AT CASHIER"
                            : p.method.toUpperCase()}{" "}
                          · {fmtTime(p.paid_at ?? p.created_at)}
                        </div>
                        {/* Staf yang memproses — kasir yang mengkonfirmasi
                            pay-at-cashier, ATAU kasir/waiter yang membuat
                            pembayarannya (QRIS/cash). */}
                        {p.confirmed_by && p.status === "paid" && (
                          <div className="text-[11px] text-muted-foreground/80">
                            processed by{" "}
                            <span className="text-foreground/90">
                              {p.confirmed_by}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-primary tabular-nums">{formatIDR(p.amount)}</div>
                        <Badge
                          variant={p.status === "paid" ? "success" : p.status === "pending" && !expired ? "warning" : "secondary"}
                          className="text-[10px]"
                        >
                          {p.status === "paid" ? "Paid" : expired ? "Cancelled" : p.status === "pending" ? "Pending" : p.superseded ? "Replaced" : "Cancelled"}
                        </Badge>
                      </div>
                    </div>
                    {canShowQr && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveQr({
                            paymentId: p.id,
                            reference: p.external_ref,
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
                    {p.status === "pending" && p.pay_at_cashier && !expired && (
                      <div className="mt-2 space-y-2">
                        {/* KASIR: form terima pembayaran (pilih metode + uang
                            tunai + kembalian) yang mengonfirmasi baris ini. */}
                        {detail.isCashier && (
                          <CashierConfirmBox
                            payerName={p.paid_by}
                            amount={p.amount}
                            busy={confirmingId === p.id}
                            onConfirm={(method, cashReceived) =>
                              handleCashierConfirm(p.id, method, cashReceived)
                            }
                          />
                        )}
                        {!detail.isCashier && (
                          <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5">
                            <p className="text-[11px] text-amber-400 flex-1">
                              Waiting for cashier confirmation — pay at the
                              cashier desk to complete this payment.
                            </p>
                            {/* Countdown sisa waktu konfirmasi. Habis → refresh
                                (server sweep membatalkan → baris jadi Cancelled). */}
                            <PayAtCashierCountdown
                              expiresAt={p.expires_at}
                              onExpire={() => router.refresh()}
                            >
                              {(mmss) => (
                                <span className="shrink-0 tabular-nums font-semibold text-amber-400 text-xs rounded bg-amber-500/20 px-1.5 py-0.5">
                                  {mmss}
                                </span>
                              )}
                            </PayAtCashierCountdown>
                          </div>
                        )}
                        {(p.paid_by_member_id === detail.myMemberId ||
                          detail.isHost ||
                          detail.isStaff) && (
                          <div className="text-center">
                            {/* Link-style (tanpa kotak) — samakan dgn layar
                                pay-at-cashier. */}
                            <button
                              type="button"
                              disabled={cancellingId === p.id || confirmingId === p.id}
                              onClick={() => handleCancelCashierPayment(p.id)}
                              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition disabled:opacity-50"
                            >
                              {cancellingId === p.id
                                ? "Cancelling…"
                                : "Cancel this payment"}
                            </button>
                          </div>
                        )}
                      </div>
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
          // Bayar PENUH tanpa split untuk: staff non-host, DAN anggota yang
          // memesan sendiri (order miliknya — split equally/treat hanya milik
          // host di order MEJA).
          payFullOnly={
            (detail.isStaff && !detail.isHost) ||
            (detail.isOwnOrder && !detail.isHost)
          }
          onClose={() => setPaySheet(false)}
          onSingle={handleSingle}
          onBatch={handleBatch}
        />
      )}

      {/* QRIS dialog — tampilan seragam: ID transaksi, nominal, countdown, poll,
          cancel. Sama seperti QRIS di flow lain. */}
      {visibleQr && (
        <QrisPaymentDialog
          paymentId={visibleQr.paymentId}
          reference={visibleQr.reference}
          qrString={visibleQr.qrString}
          amount={visibleQr.amount}
          expirySeconds={visibleQr.expirySeconds}
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
 * Panel tunai kasir BERSAMA — satu tampilan untuk dua alur:
 * - CashierPayBox (buat pembayaran baru): payer bisa dipilih (slot `payer`).
 * - CashierConfirmBox (konfirmasi pending pay-at-cashier): payer terkunci.
 *
 * Menangani: Amount due, toggle metode, Cash received + prefill amount due +
 * "Exact amount" + pecahan cepat (50rb/100rb) + kembalian/kurang bayar. Submit
 * didelegasikan ke `onSubmit(method, cashReceived?)`. Dulu dua alur ini punya
 * UI cash terpisah → hanya salah satu yang dapat fitur exact/quick → divergen.
 */
function CashierCashPanel({
  amount,
  payer,
  defaultMethod,
  busy,
  submitting,
  onSubmit,
}: {
  amount: number;
  /** Slot pembayar: dropdown (buat baru) atau nama terkunci (konfirmasi). */
  payer: React.ReactNode;
  defaultMethod: "cash" | "qris";
  busy: boolean;
  /** Teks tombol saat proses (default "Processing…"). */
  submitting?: string;
  onSubmit: (method: "cash" | "qris", cashReceived?: number) => void;
}) {
  const [method, setMethod] = React.useState<"cash" | "qris">(defaultMethod);
  // Prefill nominal tagihan — kasus paling sering: tamu membayar uang pas.
  const [cashReceived, setCashReceived] = React.useState(String(amount));
  // Tagihan bisa berubah setelah mount (mis. pembayaran lain masuk) → segarkan
  // prefill. Pola "adjust state on prop change during render" (tanpa useEffect,
  // menghindari cascading render): saat `amount` beda dari nilai basis prefill
  // terakhir, reset input & catat basis baru — semua di fase render.
  const [prefillBase, setPrefillBase] = React.useState(amount);
  if (prefillBase !== amount) {
    setPrefillBase(amount);
    setCashReceived(String(amount));
  }
  const received = parseInt(cashReceived || "0", 10) || 0;
  const change = method === "cash" ? Math.max(0, received - amount) : 0;
  const shortfall = method === "cash" ? Math.max(0, amount - received) : 0;
  const cashValid = method !== "cash" || received >= amount;
  const isExact = received === amount;

  // Pecahan cepat: pembulatan ke atas ke kelipatan lazim (50rb/100rb). Hanya
  // tampil kalau di ATAS tagihan — kalau uang pas sudah kelipatan itu, tak guna.
  const quickCash = React.useMemo(() => {
    const steps = [50_000, 100_000];
    const out: number[] = [];
    for (const s of steps) {
      const v = Math.ceil(amount / s) * s;
      if (v > amount && !out.includes(v)) out.push(v);
    }
    return out.slice(0, 2);
  }, [amount]);

  return (
    <div className="space-y-4">
      {/* Nominal tagihan = fokus utama; itu yg pertama dicari kasir. */}
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Amount due
        </p>
        <p className="text-3xl font-semibold text-primary tabular-nums mt-0.5">
          {formatIDR(amount)}
        </p>
      </div>

      {payer}

      {/* Metode */}
      <div className="grid grid-cols-2 gap-2">
        {(["cash", "qris"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border h-11 text-sm font-medium transition",
              method === m
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:border-primary/40"
            )}
          >
            {m === "qris" ? (
              <QrCode className="h-4 w-4" />
            ) : (
              <Banknote className="h-4 w-4" />
            )}
            {m === "qris" ? "QRIS" : "Cash"}
          </button>
        ))}
      </div>

      {/* Uang tunai + kembalian */}
      {method === "cash" && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">
              Cash received
            </label>
            {/* Uang pas — sekali klik, tanpa mengetik. */}
            <button
              type="button"
              onClick={() => setCashReceived(String(amount))}
              disabled={isExact}
              className={cn(
                "text-[11px] rounded-full border px-2.5 py-1 transition",
                isExact
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {isExact ? "Exact amount ✓" : "Exact amount"}
            </button>
          </div>

          <input
            inputMode="numeric"
            value={cashReceived}
            onChange={(e) =>
              setCashReceived(e.target.value.replace(/[^0-9]/g, ""))
            }
            onFocus={(e) => e.currentTarget.select()}
            placeholder={String(amount)}
            className={cn(
              "w-full rounded-lg border bg-background px-3 h-12 text-lg font-semibold tabular-nums transition",
              shortfall > 0
                ? "border-destructive/60 text-destructive"
                : "border-border"
            )}
          />

          {/* Pecahan yang lazim diserahkan tamu. */}
          {quickCash.length > 0 && (
            <div className="flex gap-2">
              {quickCash.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCashReceived(String(v))}
                  className={cn(
                    "flex-1 rounded-md border h-9 text-xs tabular-nums transition",
                    received === v
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {formatIDR(v)}
                </button>
              ))}
            </div>
          )}

          {/* Kembalian / kurang bayar — selalu terlihat, bukan hanya saat >0. */}
          <div className="flex justify-between items-center text-sm rounded-lg bg-background/60 px-3 py-2">
            <span className="text-muted-foreground">
              {shortfall > 0 ? "Still short" : "Change"}
            </span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                shortfall > 0 ? "text-destructive" : "text-emerald-400"
              )}
            >
              {formatIDR(shortfall > 0 ? shortfall : change)}
            </span>
          </div>
        </div>
      )}

      <Button
        variant="gold"
        size="lg"
        className="w-full"
        disabled={busy || !cashValid}
        onClick={() =>
          onSubmit(method, method === "cash" ? received : undefined)
        }
      >
        {busy
          ? (submitting ?? "Processing…")
          : method === "cash"
            ? `Accept ${formatIDR(received || amount)}`
            : "Generate QRIS"}
      </Button>
    </div>
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
  const [loading, setLoading] = React.useState(false);
  const [voucherInput, setVoucherInput] = React.useState("");
  const [voucherChecking, setVoucherChecking] = React.useState(false);
  const [voucherError, setVoucherError] = React.useState<string | null>(null);
  const [voucher, setVoucher] = React.useState<{
    code: string;
    name: string;
    discount: number;
  } | null>(null);

  const amount = detail.outstanding;
  // Voucher = benefit membership, jadi hanya utk pelanggan TERDAFTAR. Tamu
  // walk-in yang dibuatkan staff tak punya akun → inputnya disembunyikan.
  // (Server tetap menolak sendiri lewat cek kepemilikan voucher.)
  const payer = detail.members.find((m) => m.id === payerId);
  const canUseVoucher = !!payer && !payer.is_guest;

  // Ganti payer ke tamu → buang voucher yang sudah terpasang, supaya tak
  // ikut terkirim diam-diam.
  React.useEffect(() => {
    if (!canUseVoucher && voucher) {
      setVoucher(null);
      setVoucherInput("");
      setVoucherError(null);
    }
  }, [canUseVoucher, voucher]);

  async function applyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code) return;
    setVoucherChecking(true);
    setVoucherError(null);
    try {
      const res = await previewBillVoucher({
        code,
        sessionId: detail.sessionId,
        amount,
      });
      if (!res.ok) {
        // Tampilkan DI FIELD (bukan cuma toast) supaya kasir tahu persis
        // input mana yang bermasalah — toast keburu hilang.
        setVoucherError(res.error);
        return;
      }
      setVoucher({
        code: res.code,
        name: res.name,
        discount: res.discount,
      });
      toast.success(`Voucher applied: -${formatIDR(res.discount)}`);
    } catch {
      setVoucherError("Failed to check voucher. Try again");
    } finally {
      setVoucherChecking(false);
    }
  }

  async function accept(method: "cash" | "qris", received?: number) {
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
        // Hanya kirim kalau payer memang pelanggan terdaftar.
        voucherCode: canUseVoucher ? voucher?.code : undefined,
      });
      // WAJIB dicek sebelum apa pun: tanpa ini, pembayaran yang GAGAL
      // validasi akan tampil "Payment received" padahal uang tak masuk.
      if (!result.ok) {
        toast.error(result.error ?? "Failed to accept payment");
        return;
      }
      if (result.qrString && result.status === "pending") {
        onQr({
          paymentId: result.paymentId,
          qrString: result.qrString,
          amount,
          expirySeconds: toExpirySeconds(result.expiresAt),
        });
      } else {
        const change =
          method === "cash" && received ? Math.max(0, received - amount) : 0;
        toast.success(
          change > 0 ? `Paid. Change ${formatIDR(change)}` : "Payment received"
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
    <Card className="p-4 space-y-4">
      <div className="text-sm font-semibold">Accept payment (cashier)</div>
      <CashierCashPanel
        amount={amount}
        defaultMethod="qris"
        busy={loading}
        onSubmit={accept}
        payer={
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Payer</label>
              <Select
                value={payerId}
                onChange={setPayerId}
                ariaLabel="Payer"
                className="mt-1"
                options={detail.members.map((m) => ({
                  value: m.id,
                  label: `${m.name}${m.is_guest ? " (guest)" : ""}`,
                }))}
              />
            </div>

            {/* Voucher — hanya utk pelanggan terdaftar (tamu tak punya akun). */}
            {canUseVoucher && (
              <div>
                <label className="text-xs text-muted-foreground">
                  Voucher (optional)
                </label>
                {voucher ? (
                  <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {voucher.name} ({voucher.code})
                      </p>
                      <p className="text-xs text-primary">
                        -{formatIDR(voucher.discount)} · pay{" "}
                        {formatIDR(Math.max(0, amount - voucher.discount))}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setVoucher(null);
                        setVoucherInput("");
                      }}
                      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mt-1 flex gap-2">
                      <div className="relative flex-1 min-w-0">
                        <input
                          type="text"
                          value={voucherInput}
                          onChange={(e) => {
                            setVoucherInput(e.target.value);
                            // Mengetik ulang → buang pesan error lama.
                            if (voucherError) setVoucherError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              applyVoucher();
                            }
                          }}
                          placeholder="Voucher code"
                          aria-invalid={!!voucherError}
                          className={cn(
                            "w-full h-10 rounded-md border bg-background pl-3 pr-9 text-sm uppercase focus:outline-none",
                            voucherError
                              ? "border-destructive focus:border-destructive"
                              : "border-border focus:border-primary/60"
                          )}
                        />
                        {voucherInput && (
                          <button
                            type="button"
                            aria-label="Clear voucher code"
                            onClick={() => {
                              setVoucherInput("");
                              setVoucherError(null);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={applyVoucher}
                        disabled={voucherChecking || !voucherInput.trim()}
                        className="shrink-0"
                      >
                        {voucherChecking ? "…" : "Apply"}
                      </Button>
                    </div>
                    {voucherError && (
                      <p className="mt-1 text-xs text-destructive">
                        {voucherError}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        }
      />
    </Card>
  );
}

/**
 * Form konfirmasi pembayaran "Pay at cashier" (kasir). Sama seperti
 * CashierPayBox — pilih metode + uang tunai + kembalian — TAPI nominal &
 * pembayar TERKUNCI ke baris pending yang dikonfirmasi (bukan bikin pembayaran
 * baru). Submit → cashierConfirmPendingPayment.
 */
function CashierConfirmBox({
  payerName,
  amount,
  busy,
  onConfirm,
}: {
  payerName: string;
  amount: number;
  busy: boolean;
  onConfirm: (method: "cash" | "qris", cashReceived?: number) => void;
}) {
  return (
    <Card className="p-4 border-amber-500/30 bg-amber-500/[0.04]">
      <CashierCashPanel
        amount={amount}
        defaultMethod="cash"
        busy={busy}
        onSubmit={onConfirm}
        // Payer terkunci ke baris pending — hanya ditampilkan, tak bisa diganti.
        payer={
          <p className="text-center text-xs text-muted-foreground -mt-2">
            from <span className="text-foreground">{payerName}</span>
          </p>
        }
      />
    </Card>
  );
}
