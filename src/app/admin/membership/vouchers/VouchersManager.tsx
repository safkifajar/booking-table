"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Ticket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn, formatIDR, getActionErrorMessage } from "@/lib/utils";
import {
  updateMembershipVoucher,
  deleteMembershipVoucher,
  type AdminVoucherRow,
} from "@/lib/membership-actions";
import { VoucherDialog } from "./VoucherDialog";

/**
 * Kelola TEMPLATE voucher benefit (PRD Membership rev-2): admin membuat NAMA
 * + aturan potongan bill + level; kode unik per member digenerate otomatis
 * saat membership aktif. Mengubah template hanya memengaruhi voucher yang
 * digenerate SETELAHNYA (instance beredar = snapshot).
 */
interface Props {
  vouchers: AdminVoucherRow[];
  levelNames: Record<string, string>;
}

export function VouchersManager({ vouchers, levelNames }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editTarget, setEditTarget] = React.useState<
    { mode: "create" } | { mode: "edit"; voucher: AdminVoucherRow } | null
  >(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function handleDelete(v: AdminVoucherRow) {
    const ok = await confirm({
      title: `Delete "${v.name}"?`,
      description:
        "No member has received a voucher from this template yet, so it can be deleted permanently.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setBusyId(v.id);
    try {
      const res = await deleteMembershipVoucher(v.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`"${v.name}" deleted`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to delete voucher"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(v: AdminVoucherRow) {
    setBusyId(v.id);
    try {
      const res = await updateMembershipVoucher({
        id: v.id,
        name: v.name,
        discountType: v.discount_type,
        discountValue: v.discount_value,
        maxDiscount: v.max_discount,
        minSpend: v.min_spend,
        levelKey: (v.level_key as "premium" | "vip" | null) ?? null,
        validDays: v.valid_days,
        isActive: !v.is_active,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`"${v.name}" ${v.is_active ? "deactivated" : "activated"}`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to update voucher"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="gold" onClick={() => setEditTarget({ mode: "create" })}>
          <Plus className="h-4 w-4" /> Add Voucher
        </Button>
      </div>

      {vouchers.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">
          No voucher templates yet. Create one — members will automatically
          receive their own unique code when their membership activates.
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {vouchers.map((v) => (
            <div key={v.id} className="flex items-center gap-3 p-3 sm:p-4">
              <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <Ticket className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/admin/membership/vouchers/${v.id}`}
                    className="text-sm font-semibold hover:text-primary transition"
                  >
                    {v.name}
                  </Link>
                  <Badge variant="secondary" className="text-[10px]">
                    {v.discount_type === "percent"
                      ? `${v.discount_value}% off${v.max_discount ? ` (max ${formatIDR(v.max_discount)})` : ""}`
                      : `${formatIDR(v.discount_value)} off`}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {v.level_key
                      ? (levelNames[v.level_key] ?? v.level_key)
                      : "All paid levels"}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px]",
                      v.is_active
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : "bg-red-500/15 text-red-400 border-red-500/30"
                    )}
                  >
                    {v.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Valid {v.valid_days} days after issue
                  {v.min_spend != null && ` · min. spend ${formatIDR(v.min_spend)}`}
                  {" · "}issued {v.generated_count}×
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === v.id}
                  onClick={() => handleToggleActive(v)}
                >
                  {busyId === v.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : v.is_active ? (
                    "Deactivate"
                  ) : (
                    "Activate"
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit"
                  onClick={() => setEditTarget({ mode: "edit", voucher: v })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {v.generated_count === 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                    disabled={busyId === v.id}
                    onClick={() => handleDelete(v)}
                    className="text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground">
        Members receive one voucher per active template each time their
        membership activates (purchase, renewal, or admin grant). Every member
        gets their own unique code; editing a template doesn&apos;t change
        vouchers already issued.
      </p>

      {editTarget && (
        <VoucherDialog
          target={editTarget}
          levelNames={levelNames}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
