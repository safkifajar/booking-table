import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

/** Label role staff (value DB → tampilan). */
function roleLabel(role?: string | null): string | null {
  switch (role) {
    case "cashier":
      return "Kasir";
    case "waiter":
      return "Waiter";
    case "manager":
      return "Manager";
    case "admin":
      return "Admin";
    default:
      return null;
  }
}

/**
 * Kartu profil staff di header (kiri): avatar + nama + role (badge "Staff") +
 * sapaan. Klik → /staff/profile. Dipakai di header kasir & waiter.
 */
export function StaffProfileButton({
  displayName,
  avatarUrl,
  role,
}: {
  displayName: string;
  avatarUrl: string | null;
  /** Role staff → label + badge. Opsional (mundur-kompat). */
  role?: string | null;
}) {
  const rl = roleLabel(role);
  return (
    <Link
      href="/staff/profile"
      className="flex items-center gap-3 min-w-0 rounded-lg -m-1 p-1 hover:bg-muted/50 transition"
      aria-label="Open profile"
    >
      <Avatar className="h-11 w-11 shrink-0 border border-border">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
        <AvatarFallback className="text-sm">
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate leading-tight">
          {displayName}
        </div>
        {rl && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-muted-foreground">{rl}</span>
            <span className="inline-flex items-center rounded bg-primary/15 border border-primary/25 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
              Staff
            </span>
          </div>
        )}
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          Welcome back 👋
        </div>
      </div>
    </Link>
  );
}
