"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LogOut, UserCircle, ChevronDown } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useConfirm } from "@/components/ConfirmDialog";
import { adminSignOutAction } from "@/lib/auth-v2/admin-actions";
import { getExistingSubscription } from "@/lib/push-client";
import { removeSubscription } from "@/lib/push";
import { getActionErrorMessage, initials } from "@/lib/utils";

interface Props {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  /** Custom profile link, default ke /admin/profile */
  profileHref?: string;
}

/**
 * Dropdown header admin: avatar → menu (My Profile, Logout).
 *
 * Pakai <details> native untuk dropdown (tidak perlu lib + auto close
 * on click outside built-in browser).
 */
export function AdminHeaderProfile({
  displayName,
  email,
  avatarUrl,
  profileHref = "/admin/profile",
}: Props) {
  const confirm = useConfirm();
  const [loading, setLoading] = React.useState(false);

  async function handleLogout() {
    const ok = await confirm({
      title: "Logout admin panel?",
      description: "Kamu akan dikeluarkan dari admin panel.",
      confirmText: "Logout",
      cancelText: "Batal",
      variant: "danger",
    });
    if (!ok) return;

    setLoading(true);
    try {
      // Hapus push subscription device ini sebelum logout (cegah notif yatim).
      try {
        const sub = await getExistingSubscription();
        if (sub?.endpoint) await removeSubscription(sub.endpoint);
      } catch {
        // abaikan — logout tetap lanjut.
      }
      await adminSignOutAction();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal logout"));
      setLoading(false);
    }
  }

  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/60 transition">
        <Avatar className="h-8 w-8 ring-2 ring-primary/20">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
          <AvatarFallback className="text-[10px]">
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium hidden sm:inline max-w-[120px] truncate">
          {displayName}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-open:rotate-180 transition-transform" />
      </summary>

      <div className="absolute right-0 top-full mt-2 w-60 rounded-md border border-border bg-card shadow-2xl overflow-hidden z-[100]">
        {/* User info header */}
        <div className="px-3 py-2.5 border-b border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Logged in
          </div>
          <div className="text-sm font-medium truncate">{displayName}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {email}
          </div>
        </div>

        {/* Menu */}
        <Link
          href={profileHref}
          className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/60 transition border-b border-border"
        >
          <UserCircle className="h-4 w-4" />
          My Profile
        </Link>

        <button
          type="button"
          onClick={handleLogout}
          disabled={loading}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-red-500/10 transition text-red-400 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {loading ? "Logout..." : "Logout"}
        </button>
      </div>
    </details>
  );
}
