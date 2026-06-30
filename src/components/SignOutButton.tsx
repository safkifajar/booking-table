"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/lib/auth-v2/actions";
import { useConfirm } from "@/components/ConfirmDialog";
import { getActionErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

export function SignOutButton({ displayName }: { displayName: string }) {
  const confirm = useConfirm();
  const [loading, setLoading] = React.useState(false);

  async function handle() {
    const ok = await confirm({
      title: "Sign out of your account?",
      description: `You'll be signed out of ${displayName}. You can sign back in anytime if you use an email + password account.`,
      confirmText: "Sign out",
      cancelText: "Stay signed in",
      variant: "danger",
    });
    if (!ok) return;
    setLoading(true);
    try {
      await signOutAction();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to sign out"));
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={loading}
      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 text-red-400 disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}
