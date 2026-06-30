import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getCurrentUser,
  getCurrentProfile,
  getStaffRole,
} from "@/lib/auth-v2/current";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Sparkles,
  ChevronRight,
  User,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AvatarUploader } from "@/app/profile/AvatarUploader";
import { PushToggle } from "@/components/PushToggle";

/**
 * Staff profile (cashier, waiter).
 * Tampilan = admin profile tapi back button ke dashboard mereka.
 */
export default async function StaffProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const [user, staff] = await Promise.all([
    getCurrentUser(),
    getStaffRole(),
  ]);
  if (!staff) redirect("/login");

  // Back URL sesuai role
  const backUrl =
    staff.role === "cashier" ? "/staff/cashier" : "/staff/waiter";

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href={backUrl} aria-label="Back to Dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-primary/70">
              My Profile · {staff.role}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {profile.displayName}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Identity card */}
        <Card className="p-5">
          <AvatarUploader
            initialAvatarUrl={profile.avatarUrl}
            displayName={profile.displayName}
          />
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <div className="space-y-0.5">
              <div className="text-base font-semibold">
                {profile.displayName}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {user?.email}
              </div>
            </div>

            {profile.bio && (
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
                {profile.bio}
              </p>
            )}

            {profile.hobbies && profile.hobbies.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  <Sparkles className="h-3 w-3 text-primary/70" />
                  Hobbies & interests
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.hobbies.map((h) => (
                    <Badge key={h} variant="secondary" className="text-[11px]">
                      {h}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Notifikasi push */}
        <Card className="overflow-hidden">
          <PushToggle />
        </Card>

        {/* Menu list */}
        <Card className="overflow-hidden divide-y divide-border">
          <MenuItem
            href="/staff/profile/account"
            icon={<User className="h-4 w-4" />}
            label="Account"
            description="Name, WhatsApp number, birth date, bio, hobbies"
          />
          <MenuItem
            href="/staff/profile/password"
            icon={<KeyRound className="h-4 w-4" />}
            label="Change Password"
            description="Change your login password"
          />
        </Card>
      </div>
    </main>
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
