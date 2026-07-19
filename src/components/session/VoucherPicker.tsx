"use client";

import * as React from "react";
import { Ticket, X, Check, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn, formatIDR } from "@/lib/utils";
import { getMyVouchers } from "@/lib/membership-actions";
// Tipe diambil dari sumbernya — membership-actions ("use server") tak boleh
// meng-export tipe/nilai non-async.
import type { MyVoucherRow } from "@/lib/member-voucher";

/**
 * Pemilih voucher membership — pola "promo" (GoFood): tombol buka daftar
 * voucher MILIK user, bukan input kode manual. User tak perlu hafal/salin kode.
 *
 * Aturan tampilan (arahan user):
 * - Belum punya voucher            → halaman kosong (empty state).
 * - Punya voucher                  → daftar + tombol "Use".
 * - Voucher terpakai/kedaluwarsa   → baris DISABLED (tak bisa dipilih),
 *   diberi label alasannya.
 *
 * Kelayakan (min. spend / nominal) tetap divalidasi SERVER saat dipakai —
 * di sini hanya penyaringan visual supaya user paham kenapa tak bisa dipilih.
 */

export interface AppliedVoucher {
  code: string;
  name: string;
  discount: number;
}

interface Props {
  /** Nominal yang akan dibayar — untuk cek min. spend & estimasi diskon. */
  amount: number;
  /** Voucher yang sedang dipakai (null = belum ada). */
  applied: AppliedVoucher | null;
  /** Dipanggil saat user memilih voucher — parent yang memvalidasi ke server. */
  onPick: (code: string) => Promise<void> | void;
  /** Hapus voucher terpasang. */
  onClear: () => void;
  /** Sedang memvalidasi kode di server. */
  checking?: boolean;
}

/** Estimasi diskon dari aturan voucher (server tetap penentu akhir). */
function estimateDiscount(v: MyVoucherRow, amount: number): number {
  if (v.discount_type === "percent") {
    const raw = Math.floor((amount * v.discount_value) / 100);
    return v.max_discount ? Math.min(raw, v.max_discount) : raw;
  }
  return Math.min(v.discount_value, amount);
}

function ruleLabel(v: MyVoucherRow): string {
  const base =
    v.discount_type === "percent"
      ? `${v.discount_value}% off${v.max_discount ? ` (max ${formatIDR(v.max_discount)})` : ""}`
      : `${formatIDR(v.discount_value)} off`;
  return v.min_spend ? `${base} · min ${formatIDR(v.min_spend)}` : base;
}

export function VoucherPicker({
  amount,
  applied,
  onPick,
  onClear,
  checking,
}: Props) {
  const [open, setOpen] = React.useState(false);

  if (applied) {
    return (
      <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm space-y-1">
        <div className="flex justify-between gap-2">
          <span className="font-medium text-primary truncate">
            {applied.name}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            Remove
          </button>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Discount</span>
          <span className="text-emerald-400">
            - {formatIDR(applied.discount)}
          </span>
        </div>
        <div className="flex justify-between border-t border-border pt-1">
          <span className="text-muted-foreground">You&apos;ll pay</span>
          <span className="font-semibold text-primary">
            {formatIDR(Math.max(0, amount - applied.discount))}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={checking}
        className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 h-11 text-left hover:border-primary/40 transition disabled:opacity-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Ticket className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm truncate">
            {checking ? "Applying voucher…" : "Use a voucher"}
          </span>
        </span>
        {checking ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <VoucherSheet
          amount={amount}
          onClose={() => setOpen(false)}
          onPick={async (code) => {
            setOpen(false);
            await onPick(code);
          }}
        />
      )}
    </>
  );
}

function VoucherSheet({
  amount,
  onClose,
  onPick,
}: {
  amount: number;
  onClose: () => void;
  onPick: (code: string) => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [vouchers, setVouchers] = React.useState<MyVoucherRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await getMyVouchers();
        if (!cancelled) setVouchers(rows);
      } catch {
        if (!cancelled) toast.error("Failed to load vouchers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Ticket className="h-4 w-4 text-primary" /> My vouchers
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : vouchers.length === 0 ? (
            // Belum punya voucher sama sekali → empty state.
            <div className="py-10 text-center">
              <Ticket className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium mb-1">No vouchers yet</p>
              <p className="text-xs text-muted-foreground">
                Vouchers arrive automatically when your membership is active.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {vouchers.map((v) => {
                const belowMin = !!v.min_spend && amount < v.min_spend;
                // Disabled: sudah dipakai / kedaluwarsa / menempel di pembayaran
                // lain / belum memenuhi minimal belanja.
                const disabled =
                  v.status !== "active" || belowMin || amount <= 0;
                const reason =
                  v.status === "used"
                    ? "Already used"
                    : v.status === "expired"
                      ? "Expired"
                      : v.status === "reserved"
                        ? "Reserved for another payment"
                        : belowMin
                          ? `Min. spend ${formatIDR(v.min_spend!)}`
                          : null;
                const est = estimateDiscount(v, amount);

                return (
                  <div
                    key={v.id}
                    className={cn(
                      "rounded-lg border p-3 transition",
                      disabled
                        ? "border-border bg-muted/20 opacity-60"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium truncate",
                            !disabled && "text-primary"
                          )}
                        >
                          {v.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {ruleLabel(v)}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80 font-mono mt-0.5">
                          {v.code}
                        </p>
                        {reason ? (
                          <p className="mt-1 text-[11px] text-amber-400">
                            {reason}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-emerald-400">
                            Saves {formatIDR(est)}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onPick(v.code)}
                        className={cn(
                          "shrink-0 h-9 px-3 rounded-md text-xs font-semibold transition",
                          disabled
                            ? "border border-border text-muted-foreground cursor-not-allowed"
                            : "bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25"
                        )}
                      >
                        {disabled ? (
                          "Unavailable"
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Check className="h-3.5 w-3.5" /> Use
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
