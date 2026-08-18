"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import {
  ChevronRight,
  KeyRound,
  Lock,
  History,
  LogOut,
  BellRing,
  BellOff,
  Loader2,
  Shield,
  FileText,
  MessageCircle,
  UserCog,
  Users,
  Ban,
  Crown,
  MailOpen,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { waUrl } from "@/lib/contact";
import { signOutAction } from "@/lib/auth-v2/actions";
import { cn, getActionErrorMessage } from "@/lib/utils";
import {
  pushSupported,
  getExistingSubscription,
  subscribePush,
  unsubscribePush,
  pushFailureMessage,
} from "@/lib/push-client";
import { saveSubscription, removeSubscription } from "@/lib/push";

/**
 * iOS Settings-style list: icon + label + chevron, dengan card grouping.
 *
 * Admin akses TIDAK ada di sini — admin/staff buka panel di subdomain
 * terpisah (admin.bookingsoho.com). Pisahin entry point supaya user app
 * tidak punya clue admin panel ada (security best practice).
 */
export function ProfileMenuList({
  avatarUrl,
  displayName,
  username,
  email,
  isPrivate,
  membership,
  pendingInviteCount = 0,
  contactWa,
}: {
  avatarUrl: string | null;
  displayName: string;
  username: string | null;
  email: string | null;
  isPrivate: boolean;
  /** Level membership EFEKTIF (PRD Membership M12). */
  membership: { key: "basic" | "premium" | "vip"; name: string; expiresAt: string | null };
  /** Jumlah undangan meja yang menunggu keputusan → lencana di menu. */
  pendingInviteCount?: number;
  /** Nomor WA CS dari pengaturan bar (kosong = pakai default). */
  contactWa?: string | null;
}) {
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
        title: "Turn off notifications?",
        description:
          "You won't receive notifications (table invites, etc.) on this device. You can turn them back on anytime.",
        confirmText: "Turn off",
        cancelText: "Cancel",
        variant: "danger",
      });
      if (!ok) return;
      setPushState((s) => ({ ...s, busy: true }));
      try {
        const endpoint = await unsubscribePush();
        if (endpoint) await removeSubscription(endpoint);
        toast.success("Notifications turned off for this device");
        setPushState((s) => ({ ...s, active: false, busy: false }));
      } catch (err) {
        toast.error(getActionErrorMessage(err, "Failed to turn off notifications"));
        setPushState((s) => ({ ...s, busy: false }));
      }
    } else {
      // Aktifkan — minta izin + subscribe.
      setPushState((s) => ({ ...s, busy: true }));
      try {
        const res = await subscribePush();
        if (!res.ok) {
          toast.error(pushFailureMessage(res.reason));
          setPushState((s) => ({ ...s, busy: false }));
          return;
        }
        await saveSubscription(res.subscription);
        toast.success("Notifications enabled for this device");
        setPushState((s) => ({ ...s, active: true, busy: false }));
      } catch (err) {
        toast.error(getActionErrorMessage(err, "Failed to enable notifications"));
        setPushState((s) => ({ ...s, busy: false }));
      }
    }
  }

  async function handleLogout() {
    const ok = await confirm({
      title: "Sign out of your account?",
      description:
        "You'll be signed out of the app. You can sign back in anytime with email + password or a magic link.",
      confirmText: "Sign out",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      // Hapus push subscription device INI sebelum logout — cegah notif akun
      // yg di-logout tetap terkirim ke HP ini (subscription yatim). Best-effort.
      try {
        const sub = await getExistingSubscription();
        if (sub?.endpoint) await removeSubscription(sub.endpoint);
      } catch {
        // abaikan — logout tetap lanjut.
      }
      await signOutAction();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to sign out"));
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Kartu profil — avatar + nama + email (ala referensi) */}
      <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
        <AccountAvatar
          avatarUrl={avatarUrl}
          displayName={displayName}
          size="lg"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-base font-semibold truncate">{displayName}</div>
            <MembershipBadge membership={membership} />
          </div>
          {username && (
            <div className="text-xs text-muted-foreground truncate">
              @{username}
            </div>
          )}
          {email && (
            <div className="text-xs text-muted-foreground truncate">{email}</div>
          )}
        </div>
      </div>

      {/* Section: Account */}
      <Section title="Account">
        <MenuGroup>
          <MenuItem
            href="/profile/account"
            icon={<UserCog className="h-5 w-5" />}
            label="Edit Account"
            description="Name, WhatsApp number, date of birth, bio, hobbies"
          />
          <MenuItem
            href="/membership"
            icon={<Crown className="h-5 w-5" />}
            label="Membership"
            description={`${membership.name} plan · upgrade, renew & history`}
          />
          <MenuItem
            href="/profile/privacy"
            icon={<Lock className="h-5 w-5" />}
            label="Private Account"
            description={
              isPrivate
                ? "On, only network info is visible to others"
                : "Off, your profile is public"
            }
          />
          <MenuItem
            href="/profile/friends"
            icon={<Users className="h-5 w-5" />}
            label="Friends"
            description="Your friends & pending requests"
          />
          <MenuItem
            href="/profile/invites"
            icon={<MailOpen className="h-5 w-5" />}
            label="Table Invites"
            description="Invites to tables · who invited you & when"
            badge={pendingInviteCount}
          />
          <MenuItem
            href="/profile/blocked"
            icon={<Ban className="h-5 w-5" />}
            label="Blocked Users"
            description="People you've blocked"
          />
          <MenuItem
            href="/profile/sessions"
            icon={<History className="h-5 w-5" />}
            label="Session History"
            description="Tables you've joined"
          />
        </MenuGroup>
      </Section>

      {/* Section: Settings */}
      <Section title="Settings">
        <MenuGroup>
          <MenuItem
            href="/profile/password"
            icon={<KeyRound className="h-5 w-5" />}
            label="Change Password"
            description="Change or set a new password"
          />
          {/* Notifikasi (toggle push per perangkat) — switch ala iOS */}
          {pushState.supported && (
            <div className="w-full flex items-center gap-3 px-4 py-3.5">
              <span className="h-9 w-9 rounded-full border border-primary/30 flex items-center justify-center shrink-0 text-primary">
                {pushState.active ? (
                  <BellRing className="h-5 w-5" />
                ) : (
                  <BellOff className="h-5 w-5" />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">Notifications</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {pushState.active
                    ? "On for this device"
                    : "Off for this device"}
                </span>
              </span>
              {/* Switch: geser kanan = aktif, kiri = mati */}
              <button
                type="button"
                role="switch"
                aria-checked={pushState.active}
                aria-label={
                  pushState.active ? "Turn off notifications" : "Turn on notifications"
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
          )}
        </MenuGroup>
      </Section>

      {/* Section: Help */}
      <Section title="Help">
        <MenuGroup>
          <a
            href={waUrl(contactWa)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
          >
            <span className="h-9 w-9 rounded-full border border-primary/30 flex items-center justify-center shrink-0 text-primary">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium">Contact Support</span>
              <span className="block text-xs text-muted-foreground truncate">
                Chat SOHO admin via WhatsApp
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0" />
          </a>
          <MenuItem
            href="/privacy"
            icon={<Shield className="h-5 w-5" />}
            label="Privacy Policy"
            description="How we handle your data"
          />
          <MenuItem
            href="/terms"
            icon={<FileText className="h-5 w-5" />}
            label="Terms & Conditions"
            description="Terms of service usage"
          />
        </MenuGroup>
      </Section>

      {/* Logout (kartu terpisah, danger). Hapus akun ada di Edit Account. */}
      <MenuGroup>
        <button
          type="button"
          onClick={handleLogout}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed transition group"
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
      </MenuGroup>
    </div>
  );
}

/** Judul section (di luar kartu, teks tebal) — ala referensi. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold px-1">{title}</h2>
      {children}
    </div>
  );
}

/** Avatar user (bulat), fallback inisial nama. size 'sm' (menu) / 'lg' (kartu). */
function AccountAvatar({
  avatarUrl,
  displayName,
  size = "sm",
}: {
  avatarUrl: string | null;
  displayName: string;
  size?: "sm" | "lg";
}) {
  const box = size === "lg" ? "h-14 w-14 text-lg" : "h-8 w-8 text-sm";
  if (avatarUrl) {
    return (
      <span
        className={`relative ${box} rounded-full overflow-hidden shrink-0 border border-border`}
      >
        <Image
          src={avatarUrl}
          alt={displayName}
          fill
          sizes={size === "lg" ? "56px" : "32px"}
          className="object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className={`${box} rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 text-primary font-semibold`}
    >
      {displayName.charAt(0).toUpperCase()}
    </span>
  );
}

function MenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 backdrop-blur-sm overflow-hidden divide-y divide-border">
      {children}
    </div>
  );
}

function MenuItem({
  href,
  icon,
  iconBox,
  label,
  description,
  badge,
}: {
  href: string;
  /** Ikon di dalam kotak default (bg primary). */
  icon?: React.ReactNode;
  /** Kotak ikon kustom (ganti seluruh kotak) — mis. foto profil bulat. */
  iconBox?: React.ReactNode;
  label: string;
  description?: string;
  /** Angka lencana (mis. undangan pending). 0/undefined → tak tampil. */
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
    >
      {iconBox ?? (
        <span className="h-9 w-9 rounded-full border border-primary/30 flex items-center justify-center shrink-0 text-primary">
          {icon}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground truncate">
            {description}
          </span>
        )}
      </span>
      {!!badge && badge > 0 && (
        <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center tabular-nums">
          {badge}
        </span>
      )}
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition shrink-0" />
    </Link>
  );
}

/**
 * Badge level membership (PRD Membership M12). Warna per KEY (bukan nama —
 * nama bisa diganti admin): basic netral, premium gold, vip ungu.
 */
function MembershipBadge({
  membership,
}: {
  membership: { key: "basic" | "premium" | "vip"; name: string; expiresAt: string | null };
}) {
  const styles = {
    basic: "bg-muted text-muted-foreground border-border",
    premium: "bg-primary/15 text-primary border-primary/30",
    vip: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  } as const;
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        styles[membership.key]
      )}
    >
      {membership.name}
    </span>
  );
}
