"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvatarUploader } from "@/app/profile/AvatarUploader";
import { updateStaffProfile } from "@/lib/actions";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Form Edit Account STAFF — minimal: foto profil + nama tampilan (editable),
 * role + email (read-only). Tanpa field customer (WA/bio/gender/dll).
 */
export function StaffAccountForm({
  initialAvatarUrl,
  initialDisplayName,
  role,
  email,
}: {
  initialAvatarUrl: string | null;
  initialDisplayName: string;
  role: string;
  email: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (displayName.trim().length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      await updateStaffProfile({ displayName });
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to update profile"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Foto profil */}
      <div className="rounded-xl border border-border bg-card p-4">
        <AvatarUploader
          initialAvatarUrl={initialAvatarUrl}
          displayName={initialDisplayName}
        />
      </div>

      {/* Nama tampilan */}
      <div className="space-y-1.5">
        <label className="block text-xs uppercase tracking-wider text-muted-foreground">
          Display Name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          className="w-full rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          placeholder="Your name"
        />
      </div>

      {/* Role (read-only) */}
      <div className="space-y-1.5">
        <label className="block text-xs uppercase tracking-wider text-muted-foreground">
          Role
        </label>
        <div className="w-full rounded-md border border-border bg-muted/20 px-3 py-2.5 text-sm capitalize text-muted-foreground">
          {role}
        </div>
      </div>

      {/* Email (read-only) */}
      <div className="space-y-1.5">
        <label className="block text-xs uppercase tracking-wider text-muted-foreground">
          Email
        </label>
        <div className="w-full rounded-md border border-border bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground truncate">
          {email || "—"}
        </div>
      </div>

      <Button
        type="button"
        variant="gold"
        size="lg"
        className="w-full"
        onClick={handleSave}
        disabled={saving || displayName.trim() === initialDisplayName.trim()}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          "Save changes"
        )}
      </Button>
    </div>
  );
}
