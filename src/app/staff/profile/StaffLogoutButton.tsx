"use client";

import * as React from "react";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { signOutAction } from "@/lib/auth-v2/actions";
import { getActionErrorMessage } from "@/lib/utils";

/** Tombol logout staff (kartu merah terpisah) — gaya sama dgn profil customer. */
export function StaffLogoutButton() {
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = React.useState(false);

  async function handleLogout() {
    const ok = await confirm({
      title: "Sign out of your account?",
      description: "You'll be signed out of the dashboard.",
      confirmText: "Sign out",
      cancelText: "Cancel",
      variant: "destructive",
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await signOutAction();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to sign out"));
      setSigningOut(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/70 backdrop-blur-sm overflow-hidden">
      <button
        type="button"
        onClick={handleLogout}
        disabled={signingOut}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        <span className="h-9 w-9 rounded-full border border-red-500/30 flex items-center justify-center shrink-0 text-red-400">
          <LogOut className="h-5 w-5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-red-400">
            {signingOut ? "Signing out..." : "Logout"}
          </span>
        </span>
      </button>
    </div>
  );
}
