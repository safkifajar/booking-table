"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Ticket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn, formatIDR, getActionErrorMessage } from "@/lib/utils";
import {
  createMembershipVoucher,
  updateMembershipVoucher,
  deleteMembershipVoucher,
  type AdminVoucherRow,
} from "@/lib/membership-actions";

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

/* ---------- Dialog create/edit template ---------- */

function VoucherDialog({
  target,
  levelNames,
  onClose,
}: {
  target: { mode: "create" } | { mode: "edit"; voucher: AdminVoucherRow };
  levelNames: Record<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const v = target.mode === "edit" ? target.voucher : null;

  const [name, setName] = React.useState(v?.name ?? "");
  const [discountType, setDiscountType] = React.useState<string>(
    v?.discount_type ?? "percent"
  );
  const [discountValue, setDiscountValue] = React.useState(
    v ? String(v.discount_value) : ""
  );
  const [maxDiscount, setMaxDiscount] = React.useState(
    v?.max_discount != null ? String(v.max_discount) : ""
  );
  const [minSpend, setMinSpend] = React.useState(
    v?.min_spend != null ? String(v.min_spend) : ""
  );
  const [levelKey, setLevelKey] = React.useState<string>(v?.level_key ?? "");
  const [validDays, setValidDays] = React.useState(String(v?.valid_days ?? 30));
  const [isActive, setIsActive] = React.useState(v?.is_active ?? true);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        discountType: discountType as "percent" | "fixed",
        discountValue: Math.max(1, parseInt(discountValue, 10) || 0),
        maxDiscount:
          discountType === "percent" && maxDiscount.trim()
            ? Math.max(1, parseInt(maxDiscount, 10) || 1)
            : null,
        minSpend: minSpend.trim()
          ? Math.max(1, parseInt(minSpend, 10) || 1)
          : null,
        levelKey: (levelKey || null) as "premium" | "vip" | null,
        validDays: Math.max(1, parseInt(validDays, 10) || 30),
        isActive,
      };
      const res = v
        ? await updateMembershipVoucher({ id: v.id, ...payload })
        : await createMembershipVoucher(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(v ? "Voucher updated" : "Voucher created");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save voucher"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{v ? `Edit "${v.name}"` : "New Voucher"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Voucher name (shown to members)">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={3}
              maxLength={60}
              placeholder="e.g. Premium Dining Discount"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select
                value={discountType}
                onChange={setDiscountType}
                options={[
                  { value: "percent", label: "Percent (%)" },
                  { value: "fixed", label: "Fixed (IDR)" },
                ]}
              />
            </Field>
            <Field
              label={discountType === "percent" ? "Percent (1-100)" : "Amount (IDR)"}
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={discountType === "percent" ? 100 : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {discountType === "percent" ? (
              <Field label="Max discount IDR (optional)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  placeholder="No cap"
                  className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
                />
              </Field>
            ) : (
              <div />
            )}
            <Field label="Min. payment IDR (optional)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={minSpend}
                onChange={(e) => setMinSpend(e.target.value)}
                placeholder="No minimum"
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Membership level">
              <Select
                value={levelKey}
                onChange={setLevelKey}
                options={[
                  { value: "", label: "All paid levels" },
                  { value: "premium", label: levelNames.premium ?? "Premium" },
                  { value: "vip", label: levelNames.vip ?? "VIP" },
                ]}
              />
            </Field>
            <Field label="Valid for (days after issue)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
          </div>
          <Field label="Status">
            <button
              type="button"
              onClick={() => setIsActive((x) => !x)}
              className={cn(
                "flex w-full items-center justify-between rounded-md border px-3 h-10 text-sm transition",
                isActive
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
              )}
            >
              <span>{isActive ? "Active" : "Inactive"}</span>
              <span className="text-xs opacity-70">
                {isActive
                  ? "Issued on every activation"
                  : "Not issued to new activations"}
              </span>
            </button>
          </Field>
          <DialogFooter className="pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
