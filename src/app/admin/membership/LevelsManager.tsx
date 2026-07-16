"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { cn, formatIDR, getActionErrorMessage } from "@/lib/utils";
import { updateMembershipLevel } from "@/lib/membership-actions";
import type { MembershipLevelRow } from "@/lib/membership";

const PERIOD_LABEL: Record<MembershipLevelRow["billing_period"], string> = {
  one_time: "One-time (lifetime)",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** Warna badge per KEY (nama bisa diganti admin — warna menempel ke key). */
const KEY_STYLE: Record<string, string> = {
  basic: "bg-muted text-muted-foreground border-border",
  premium: "bg-primary/15 text-primary border-primary/30",
  vip: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

export function LevelsManager({ levels }: { levels: MembershipLevelRow[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {levels.map((l) => (
        <LevelCard key={l.key} level={l} />
      ))}
    </div>
  );
}

function LevelCard({ level }: { level: MembershipLevelRow }) {
  const router = useRouter();
  const isBasic = level.key === "basic";
  const [name, setName] = React.useState(level.name);
  const [price, setPrice] = React.useState(String(level.price));
  const [period, setPeriod] = React.useState<string>(level.billing_period);
  const [description, setDescription] = React.useState(level.description ?? "");
  const [saving, setSaving] = React.useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await updateMembershipLevel({
        key: level.key,
        name: name.trim(),
        price: isBasic ? 0 : Math.max(0, parseInt(price, 10) || 0),
        billingPeriod: (isBasic ? "monthly" : period) as
          | "one_time"
          | "monthly"
          | "yearly",
        description: description.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${name.trim()} saved`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save level"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSave}
      className="rounded-xl border border-border bg-card p-5 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider",
            KEY_STYLE[level.key]
          )}
        >
          <Crown className="h-3 w-3" />
          {level.key}
        </span>
        <Badge variant="secondary" className="text-[10px]">
          Tier {level.rank}
        </Badge>
      </div>

      <Field label="Display name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={40}
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </Field>

      {isBasic ? (
        <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Free tier — price locked at {formatIDR(0)}, not purchasable.
        </div>
      ) : (
        <>
          <Field label="Price (IDR)">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </Field>
          <Field label="Billing">
            <Select
              value={period}
              onChange={setPeriod}
              options={[
                { value: "monthly", label: PERIOD_LABEL.monthly },
                { value: "yearly", label: PERIOD_LABEL.yearly },
                { value: "one_time", label: PERIOD_LABEL.one_time },
              ]}
            />
          </Field>
        </>
      )}

      <Field label="Description (shown on the buy page)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={280}
          rows={3}
          className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 resize-none"
        />
      </Field>

      <div className="flex justify-end pt-1">
        <Button type="submit" variant="gold" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </form>
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
