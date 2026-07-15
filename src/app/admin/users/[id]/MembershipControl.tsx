"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Loader2 } from "lucide-react";
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
import { adminSetMembership } from "@/lib/membership-actions";

interface MembershipInfo {
  key: "basic" | "premium" | "vip";
  name: string;
  /** ISO; null = tanpa batas (basic / lifetime). */
  expiresAt: string | null;
  expired: boolean;
}

const KEY_STYLE: Record<string, string> = {
  basic: "bg-muted text-muted-foreground border-border",
  premium: "bg-primary/15 text-primary border-primary/30",
  vip: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

const DURATIONS = [
  { value: "1", label: "1 month" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "1 year" },
  { value: "lifetime", label: "Lifetime" },
] as const;

/**
 * Status + kontrol ubah membership customer di detail admin (PRD M8, M12).
 * Perubahan menimpa masa aktif berjalan (G5) — ada peringatan sebelum simpan.
 */
export function MembershipControl({
  customerId,
  customerName,
  membership,
  levelNames,
}: {
  customerId: string;
  customerName: string;
  membership: MembershipInfo;
  levelNames: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [levelKey, setLevelKey] = React.useState<string>(membership.key);
  const [duration, setDuration] = React.useState<string>("1");
  const [saving, setSaving] = React.useState(false);

  const expiryLabel =
    membership.key === "basic"
      ? null
      : membership.expiresAt
        ? `until ${new Date(membership.expiresAt).toLocaleDateString("en-US", { dateStyle: "medium" })}`
        : "lifetime";

  async function handleSave() {
    setSaving(true);
    try {
      const res = await adminSetMembership({
        customerId,
        levelKey: levelKey as "basic" | "premium" | "vip",
        durationMonths:
          levelKey === "basic" || duration === "lifetime"
            ? null
            : parseInt(duration, 10),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Membership updated");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to update membership"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider",
            KEY_STYLE[membership.key]
          )}
        >
          <Crown className="h-3 w-3" />
          {membership.name}
        </span>
        {expiryLabel && (
          <span className="text-xs text-muted-foreground">{expiryLabel}</span>
        )}
        {membership.expired && (
          <span className="text-xs text-red-400">expired</span>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Change
        </Button>
      </div>

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Change membership — {customerName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Level
                </label>
                <Select
                  value={levelKey}
                  onChange={setLevelKey}
                  options={[
                    { value: "basic", label: levelNames.basic ?? "Basic" },
                    { value: "premium", label: levelNames.premium ?? "Premium" },
                    { value: "vip", label: levelNames.vip ?? "VIP" },
                  ]}
                />
              </div>
              {levelKey !== "basic" && (
                <div>
                  <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                    Duration (from today)
                  </label>
                  <Select
                    value={duration}
                    onChange={setDuration}
                    options={[...DURATIONS]}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground rounded-md bg-muted/40 border border-border p-2.5">
                This overwrites the current level and any remaining active
                period, and is recorded as an admin grant in the transaction
                history.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="gold" disabled={saving} onClick={handleSave}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
