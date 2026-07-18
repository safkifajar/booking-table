"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, getActionErrorMessage } from "@/lib/utils";
import {
  createMembershipVoucher,
  updateMembershipVoucher,
  type AdminVoucherRow,
} from "@/lib/membership-actions";

/**
 * Dialog create/edit TEMPLATE voucher — dipakai list Vouchers dan halaman
 * detail template. Mengubah template hanya memengaruhi voucher yang
 * digenerate setelahnya (instance beredar pegang snapshot).
 */
export function VoucherDialog({
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
