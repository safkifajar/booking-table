"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/actions";
import { useConfirm } from "@/components/ConfirmDialog";
import { getActionErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

export function SignOutButton({ displayName }: { displayName: string }) {
  const confirm = useConfirm();
  const [loading, setLoading] = React.useState(false);

  async function handle() {
    const ok = await confirm({
      title: "Keluar dari akun?",
      description: `Kamu akan dikeluarkan dari ${displayName}. Bisa masuk lagi kapan saja kalau pakai akun email + password.`,
      confirmText: "Keluar",
      cancelText: "Tetap masuk",
      variant: "danger",
    });
    if (!ok) return;
    setLoading(true);
    try {
      await signOut();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal keluar"));
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
      {loading ? "Keluar..." : "Keluar"}
    </button>
  );
}
