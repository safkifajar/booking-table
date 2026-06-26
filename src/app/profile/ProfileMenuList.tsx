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
  BellRing,
  BellOff,
  Loader2,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { signOutAction } from "@/lib/auth-v2/actions";
import { getActionErrorMessage } from "@/lib/utils";
import {
  pushSupported,
  getExistingSubscription,
  subscribePush,
  unsubscribePush,
  notificationPermission,
} from "@/lib/push-client";
import { saveSubscription, removeSubscription } from "@/lib/push";

/**
 * iOS Settings-style list: icon + label + chevron, dengan card grouping.
 *
 * Admin akses TIDAK ada di sini — admin/staff buka panel di subdomain
 * terpisah (admin.bookingsoho.com). Pisahin entry point supaya user app
 * tidak punya clue admin panel ada (security best practice).
 */
export function ProfileMenuList() {
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = React.useState(false);

  // Status notifikasi push di perangkat ini.
  const [pushState, setPushState] = React.useState<{
    supported: boolean;
    active: boolean; // ada subscription di device ini
    busy: boolean;
  }>({ supported: false, active: false, busy: false });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) return;
      const sub = await getExistingSubscription();
      if (!cancelled) {
        setPushState((s) => ({ ...s, supported: true, active: !!sub }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleTogglePush() {
    if (pushState.busy) return;
    if (pushState.active) {
      // Matikan — konfirmasi dulu.
      const ok = await confirm({
        title: "Matikan notifikasi?",
        description:
          "Kamu tidak akan terima notifikasi (undangan meja, dll) di perangkat ini. Bisa diaktifkan lagi kapan saja.",
        confirmText: "Matikan",
        cancelText: "Batal",
        variant: "danger",
      });
      if (!ok) return;
      setPushState((s) => ({ ...s, busy: true }));
      try {
        const endpoint = await unsubscribePush();
        if (endpoint) await removeSubscription(endpoint);
        toast.success("Notifikasi dimatikan untuk perangkat ini");
        setPushState((s) => ({ ...s, active: false, busy: false }));
      } catch (err) {
        toast.error(getActionErrorMessage(err, "Gagal matikan notifikasi"));
        setPushState((s) => ({ ...s, busy: false }));
      }
    } else {
      // Aktifkan — minta izin + subscribe.
      setPushState((s) => ({ ...s, busy: true }));
      try {
        const sub = await subscribePush();
        if (!sub) {
          toast.error(
            notificationPermission() === "denied"
              ? "Izin notifikasi diblokir. Aktifkan dari pengaturan browser."
              : "Izin notifikasi ditolak"
          );
          setPushState((s) => ({ ...s, busy: false }));
          return;
        }
        await saveSubscription(sub);
        toast.success("Notifikasi diaktifkan untuk perangkat ini");
        setPushState((s) => ({ ...s, active: true, busy: false }));
      } catch (err) {
        toast.error(getActionErrorMessage(err, "Gagal aktifkan notifikasi"));
        setPushState((s) => ({ ...s, busy: false }));
      }
    }
  }

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
      {/* Group: Account */}
      <MenuGroup>
        <MenuItem
          href="/profile/account"
          icon={<User className="h-4 w-4" />}
          label="Account"
          description="Nama, nomor WA, tanggal lahir, bio, hobi"
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

      {/* Group: Notifikasi (toggle push per perangkat) — switch ala iOS */}
      {pushState.supported && (
        <MenuGroup>
          <div className="w-full flex items-center gap-3 px-4 py-3.5">
            <span
              className={
                pushState.active
                  ? "h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 text-primary"
                  : "h-8 w-8 rounded-md bg-muted border border-border flex items-center justify-center shrink-0 text-muted-foreground"
              }
            >
              {pushState.active ? (
                <BellRing className="h-4 w-4" />
              ) : (
                <BellOff className="h-4 w-4" />
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium">Notifikasi</span>
              <span className="block text-xs text-muted-foreground truncate">
                {pushState.active
                  ? "Aktif di perangkat ini"
                  : "Nonaktif di perangkat ini"}
              </span>
            </span>
            {/* Switch: geser kanan = aktif (emas), kiri = mati (abu) */}
            <button
              type="button"
              role="switch"
              aria-checked={pushState.active}
              aria-label={
                pushState.active ? "Matikan notifikasi" : "Aktifkan notifikasi"
              }
              onClick={handleTogglePush}
              disabled={pushState.busy}
              className={[
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                pushState.active ? "bg-primary" : "bg-muted-foreground/30",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
                  pushState.active ? "translate-x-[22px]" : "translate-x-0.5",
                ].join(" ")}
              >
                {pushState.busy && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </span>
            </button>
          </div>
        </MenuGroup>
      )}

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
