import Link from "next/link";
import { Crown, ChevronRight } from "lucide-react";
import { getMembershipStatus } from "@/lib/membership";

/**
 * Banner membership di home (PRD Membership M11) — server component:
 * - basic → ajakan upgrade;
 * - member berbayar H-7 kedaluwarsa → ajakan perpanjang;
 * - selain itu → tidak render apa-apa.
 * Klik → /membership (pilihan paket).
 */
export async function MembershipBanner({ profileId }: { profileId: string }) {
  const status = await getMembershipStatus(profileId);

  let title: string;
  let body: string;
  if (status.key === "basic") {
    title = status.expired
      ? "Your membership has expired"
      : "Unlock more of SOHO";
    body = status.expired
      ? "Renew to reconnect with more members, stories, and invites."
      : "Upgrade to see and connect with more members.";
  } else if (status.expires_at) {
    const daysLeft = Math.ceil(
      (status.expires_at.getTime() - Date.now()) / 86_400_000
    );
    if (daysLeft > 7) return null;
    title = `${status.name} expires in ${daysLeft <= 1 ? "1 day" : `${daysLeft} days`}`;
    body = "Renew now to keep your access — time is added to your current period.";
  } else {
    return null; // lifetime — tak perlu banner
  }

  return (
    <Link
      href="/membership"
      className="flex items-center gap-3 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3.5 hover:border-primary/50 transition group"
    >
      <div className="h-9 w-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
        <Crown className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-primary truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{body}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-primary/60 group-hover:text-primary transition shrink-0" />
    </Link>
  );
}
