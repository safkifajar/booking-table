"use client";

import * as React from "react";
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

interface Props {
  vouchers: AdminVoucherRow[];
  /** key level -> nama tampilan (utk label scope). */
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
      title: `Delete voucher ${v.code}?`,
      description: "This voucher has never been used, so it can be deleted permanently.",
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
      toast.success(`Voucher ${v.code} deleted`);
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
        code: v.code,
        discountType: v.discount_type,
        discountValue: v.discount_value,
        levelKey: (v.level_key as "premium" | "vip" | null) ?? null,
        maxUses: v.max_uses,
        perUserLimit: v.per_user_limit,
        validFrom: v.valid_from,
        validUntil: v.valid_until,
        isActive: !v.is_active,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${v.code} ${v.is_active ? "deactivated" : "activated"}`);
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
          No vouchers yet. Create one for launch promos or targeted discounts.
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
                  <span className="text-sm font-semibold tracking-wide">
                    {v.code}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {v.discount_type === "percent"
                      ? `${v.discount_value}% off`
                      : `${formatIDR(v.discount_value)} off`}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {v.level_key ? (levelNames[v.level_key] ?? v.level_key) : "All levels"}
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
                  Used {v.used_count}
                  {v.max_uses != null ? ` / ${v.max_uses}` : " (no quota)"}
                  {" · "}max {v.per_user_limit}× per user
                  {v.valid_until &&
                    ` · until ${new Date(v.valid_until).toLocaleDateString("en-US", { dateStyle: "medium" })}`}
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
                {v.used_count === 0 && (
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

/* ---------- Dialog create/edit ---------- */

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

  const [code, setCode] = React.useState(v?.code ?? "");
  const [discountType, setDiscountType] = React.useState<string>(
    v?.discount_type ?? "percent"
  );
  const [discountValue, setDiscountValue] = React.useState(
    v ? String(v.discount_value) : ""
  );
  const [levelKey, setLevelKey] = React.useState<string>(v?.level_key ?? "");
  const [maxUses, setMaxUses] = React.useState(
    v?.max_uses != null ? String(v.max_uses) : ""
  );
  const [perUserLimit, setPerUserLimit] = React.useState(
    String(v?.per_user_limit ?? 1)
  );
  // datetime-local butuh format "YYYY-MM-DDTHH:mm" waktu lokal.
  const toLocal = (iso: string | null) =>
    iso
      ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";
  const [validFrom, setValidFrom] = React.useState(toLocal(v?.valid_from ?? null));
  const [validUntil, setValidUntil] = React.useState(toLocal(v?.valid_until ?? null));
  const [isActive, setIsActive] = React.useState(v?.is_active ?? true);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        discountType: discountType as "percent" | "fixed",
        discountValue: Math.max(1, parseInt(discountValue, 10) || 0),
        levelKey: (levelKey || null) as "premium" | "vip" | null,
        maxUses: maxUses.trim() ? Math.max(1, parseInt(maxUses, 10) || 1) : null,
        perUserLimit: Math.max(1, parseInt(perUserLimit, 10) || 1),
        validFrom: validFrom ? new Date(validFrom).toISOString() : null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
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
          <DialogTitle>{v ? `Edit ${v.code}` : "New Voucher"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Code">
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))
              }
              required
              minLength={3}
              maxLength={32}
              placeholder="e.g. LAUNCH50"
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
            <Field label={discountType === "percent" ? "Percent (1-100)" : "Amount (IDR)"}>
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
          <Field label="Applies to">
            <Select
              value={levelKey}
              onChange={setLevelKey}
              options={[
                { value: "", label: "All purchasable levels" },
                { value: "premium", label: levelNames.premium ?? "Premium" },
                { value: "vip", label: levelNames.vip ?? "VIP" },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max uses (empty = unlimited)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
            <Field label="Limit per user">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={perUserLimit}
                onChange={(e) => setPerUserLimit(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from (optional)">
              <input
                type="datetime-local"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </Field>
            <Field label="Valid until (optional)">
              <input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
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
                {isActive ? "Tap to deactivate" : "Tap to activate"}
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
