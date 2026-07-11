import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

/**
 * Tombol profil staff di header (kiri): avatar + nama user. Klik → halaman
 * /staff/profile (bukan dropdown popup). Dipakai di header kasir & waiter.
 */
export function StaffProfileButton({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) {
  return (
    <Link
      href="/staff/profile"
      className="flex items-center gap-2.5 min-w-0 rounded-md -m-1 p-1 hover:bg-muted/50 transition"
      aria-label="Open profile"
    >
      <Avatar className="h-9 w-9 shrink-0 border border-border">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
        <AvatarFallback className="text-sm">
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm font-semibold truncate min-w-0">
        {displayName}
      </span>
    </Link>
  );
}
