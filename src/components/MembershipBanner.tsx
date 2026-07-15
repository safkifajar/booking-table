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
  let cta: string;
  if (status.key === "basic") {
    title = status.expired ? "Your membership expired" : "Unlock more of SOHO";
    body = status.expired
      ? "Renew to reconnect with more members & stories"
      : "Upgrade to see & connect with more members";
    cta = status.expired ? "Renew" : "Upgrade";
  } else if (status.expires_at) {
    const daysLeft = Math.ceil(
      (status.expires_at.getTime() - Date.now()) / 86_400_000
    );
    if (daysLeft > 7) return null;
    title = `${status.name} expires in ${daysLeft <= 1 ? "1 day" : `${daysLeft} days`}`;
    body = "Renew now — time is added to your current period";
    cta = "Renew";
  } else {
    return null; // lifetime — tak perlu banner
  }

  // Gaya solid-fill (bukan outline): blok gradasi gold SOHO + ikon kotak
  // rounded di kiri + pill CTA kontras di kanan (pola banner reward).
  return (
    <Link
      href="/membership"
      className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-primary via-primary to-primary/75 p-3.5 shadow-lg shadow-primary/20 transition hover:shadow-primary/35 group"
    >
      {/* Aksen dekoratif lembut — di pojok KIRI-atas, jauh dari pill CTA
          supaya tepinya tak memotong tombol. */}
      <div className="pointer-events-none absolute -left-8 -top-12 h-24 w-24 rounded-full bg-white/10" />

      <div className="h-10 w-10 rounded-xl bg-black/20 flex items-center justify-center shrink-0">
        <Crown className="h-5 w-5 text-primary-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-primary-foreground truncate">
          {title}
        </p>
        <p className="text-xs text-primary-foreground/75 truncate">{body}</p>
      </div>
      <span className="relative z-10 shrink-0 inline-flex items-center gap-1 rounded-full bg-background px-3.5 py-1.5 text-xs font-semibold text-primary shadow group-hover:scale-105 transition">
        {cta}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
