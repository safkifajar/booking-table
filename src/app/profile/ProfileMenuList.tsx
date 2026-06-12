"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, User, KeyRound, History, LogOut, Camera } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { signOutAction } from "@/lib/auth-v2/actions";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * iOS Settings-style list: icon + label + chevron, dengan card grouping.
 */
export function ProfileMenuList() {
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = React.useState(false);

  async function handleLogout() {
    const ok = await confirm({
      title: "Keluar dari akun?",
      description:
        "Kamu akan dikeluarkan dari aplikasi. Bisa masuk lagi kapan saja pakai email + password atau magic link.",
      confirmText: "Keluar",
      cancelText: "Batal",
      variant: "danger",
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await signOutAction();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal keluar"));
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Group 1: Account */}
      <MenuGroup>
        <MenuItem
          href="/profile/account"
          icon={<User className="h-4 w-4" />}
          label="Account"
          description="Nama, nomor HP, tanggal lahir, bio, hobi"
        />
        <MenuItem
          href="/profile/password"
          icon={<KeyRound className="h-4 w-4" />}
          label="Change Password"
          description="Ubah atau set password baru"
        />
        <MenuItem
          href="/profile/sessions"
          icon={<History className="h-4 w-4" />}
          label="Riwayat Session"
          description="Meja yang pernah kamu ikuti"
        />
        <MenuItem
          href="/profile/stories"
          icon={<Camera className="h-4 w-4" />}
          label="Story Saya"
          description="Story aktif yang kamu upload"
        />
      </MenuGroup>

      {/* Group 2: Logout (separate card, danger style) */}
      <MenuGroup>
        <button
          type="button"
          onClick={handleLogout}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed transition group"
        >
          <span className="h-8 w-8 rounded-md bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0 text-red-400">
            <LogOut className="h-4 w-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-red-400">
              {signingOut ? "Keluar..." : "Logout"}
            </span>
          </span>
        </button>
      </MenuGroup>
    </div>
  );
}

function MenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
      {children}
    </div>
  );
}

function MenuItem({
  href,
  icon,
  label,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
    >
      <span className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 text-primary">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground truncate">
            {description}
          </span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0" />
    </Link>
  );
}
