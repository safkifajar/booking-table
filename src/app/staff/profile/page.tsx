import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getCurrentUser,
  getCurrentProfile,
  getStaffRole,
} from "@/lib/auth-v2/current";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, UserCog, KeyRound } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { PushToggle } from "@/components/PushToggle";
import { StaffLogoutButton } from "./StaffLogoutButton";

/**
 * Staff profile (cashier, waiter) — gaya card grouped list, disamakan dgn
 * halaman profil customer (kartu profil + section header + baris menu ikon
 * lingkaran + subtitle). Back button ke dashboard sesuai role.
 */
export default async function StaffProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const [user, staff] = await Promise.all([getCurrentUser(), getStaffRole()]);
  if (!staff) redirect("/login");

  const backUrl =
    staff.role === "cashier" ? "/staff/cashier" : "/staff/waiter";

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href={backUrl} aria-label="Back to Dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="flex-1 min-w-0 text-base sm:text-lg font-semibold truncate">
            My Profile
          </h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Kartu profil — avatar + nama + email (display; ganti foto di Edit
            Account) — samakan dgn profil customer. */}
        <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
          <Avatar className="h-14 w-14 shrink-0 border border-border">
            {profile.avatarUrl && (
              <AvatarImage src={profile.avatarUrl} alt={profile.displayName} />
            )}
            <AvatarFallback className="text-lg">
              {initials(profile.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-base font-semibold truncate">
              {profile.displayName}
            </div>
            {user?.email && (
              <div className="text-xs text-muted-foreground truncate">
                {user.email}
              </div>
            )}
          </div>
        </div>

        {/* Section: Settings (notifikasi) */}
        <Section title="Settings">
          <MenuGroup>
            <PushToggle />
          </MenuGroup>
        </Section>

        {/* Section: Account */}
        <Section title="Account">
          <MenuGroup>
            <MenuItem
              href="/staff/profile/account"
              icon={<UserCog className="h-5 w-5" />}
              label="Edit Account"
              description="Profile photo & display name"
            />
            <MenuItem
              href="/staff/profile/password"
              icon={<KeyRound className="h-5 w-5" />}
              label="Change Password"
              description="Change your login password"
            />
          </MenuGroup>
        </Section>

        {/* Logout (kartu merah terpisah, spt profil customer) */}
        <StaffLogoutButton />
      </div>
    </main>
  );
}

/** Judul section (di luar kartu, teks tebal) — samakan dgn profil customer. */
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
      <span className="h-9 w-9 rounded-full border border-primary/30 flex items-center justify-center shrink-0 text-primary">
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
