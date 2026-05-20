import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";
import { LogIn, User } from "lucide-react";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Server Component: tampilkan avatar + nama user kalau login, atau tombol Sign In.
 * Dropdown menu via <details> (no JS dep) — klik avatar untuk buka.
 */
export async function UserMenu() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/auth">
          <LogIn className="h-4 w-4" /> Masuk
        </Link>
      </Button>
    );
  }

  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer flex items-center gap-2 px-2 py-1 rounded-full hover:bg-muted transition">
        <Avatar className="h-8 w-8">
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} />}
          <AvatarFallback className="text-[10px]">
            {initials(profile.display_name)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium hidden sm:inline max-w-[120px] truncate">
          {profile.display_name}
        </span>
      </summary>

      <div className="absolute right-0 top-full mt-2 w-56 rounded-md border border-border bg-card shadow-2xl overflow-hidden z-[100]">
        <div className="px-3 py-2 border-b border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Masuk sebagai
          </div>
          <div className="text-sm font-medium truncate">{profile.display_name}</div>
        </div>
        <SignOutButton displayName={profile.display_name} />
      </div>
    </details>
  );
}

/**
 * Compact version (tanpa nama, cuma avatar) — untuk dipakai di header tight space.
 */
export async function UserMenuCompact() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <Button asChild variant="ghost" size="icon">
        <Link href="/auth" aria-label="Masuk">
          <User className="h-5 w-5" />
        </Link>
      </Button>
    );
  }

  return (
    <details className="relative">
      <summary className="list-none cursor-pointer">
        <Avatar className="h-8 w-8 hover:ring-2 hover:ring-primary/40 transition">
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} />}
          <AvatarFallback className="text-[10px]">
            {initials(profile.display_name)}
          </AvatarFallback>
        </Avatar>
      </summary>

      <div className="absolute right-0 top-full mt-2 w-56 rounded-md border border-border bg-card shadow-2xl overflow-hidden z-[100]">
        <div className="px-3 py-2 border-b border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Masuk sebagai
          </div>
          <div className="text-sm font-medium truncate">{profile.display_name}</div>
        </div>
        <SignOutButton displayName={profile.display_name} />
      </div>
    </details>
  );
}
