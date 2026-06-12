"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronRight,
  User,
  KeyRound,
  History,
  LogOut,
  Camera,
  TrendingUp,
  ChefHat,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { signOutAction } from "@/lib/auth-v2/actions";
import { getActionErrorMessage } from "@/lib/utils";

interface Props {
  /** Role user di staff_roles — null kalau bukan staff */
  staffRole?: "admin" | "manager" | "waiter" | null;
}

/**
 * iOS Settings-style list: icon + label + chevron, dengan card grouping.
 *
 * Kalau user punya staff role, tampilkan grup "Akses Staff" di atas
 * (Admin Dashboard + Staff Dashboard).
 */
export function ProfileMenuList({ staffRole }: Props = {}) {
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

  const isAdminOrManager = staffRole === "admin" || staffRole === "manager";

  return (
    <div className="space-y-4">
      {/* Group: Akses Staff — kondisional, paling atas (priority) */}
      {staffRole && (
        <div>
          <h2 className="text-[10px] uppercase tracking-widest text-primary/70 font-semibold mb-2 px-1">
            Akses Staff · {staffRole}
          </h2>
          <MenuGroup>
            {isAdminOrManager && (
              <MenuItem
                href="/admin"
                icon={<TrendingUp className="h-4 w-4" />}
                label="Admin Dashboard"
                description="Laporan penjualan, transaksi, banner promo"
                variant="gold"
              />
            )}
            <MenuItem
              href="/staff"
              icon={<ChefHat className="h-4 w-4" />}
              label="Staff Dashboard"
              description="Queue order, active tables, QR code"
              variant="gold"
            />
          </MenuGroup>
        </div>
      )}

      {/* Group: Account */}
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
  variant,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  /** "gold" untuk highlight item (mis. staff access) */
  variant?: "gold";
}) {
  const isGold = variant === "gold";
  return (
    <Link
      href={href}
      className={
        isGold
          ? "flex items-center gap-3 px-4 py-3.5 bg-gradient-to-r from-primary/10 to-transparent hover:from-primary/20 active:from-primary/30 transition group"
          : "flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
      }
    >
      <span className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 text-primary">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={
            isGold
              ? "block text-sm font-semibold text-primary"
              : "block text-sm font-medium"
          }
        >
          {label}
        </span>
        {description && (
          <span className="block text-xs text-muted-foreground truncate">
            {description}
          </span>
        )}
      </span>
      <ChevronRight
        className={
          isGold
            ? "h-4 w-4 text-primary group-hover:translate-x-0.5 transition shrink-0"
            : "h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0"
        }
      />
    </Link>
  );
}
