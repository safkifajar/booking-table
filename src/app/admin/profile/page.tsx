import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { Card } from "@/components/ui/card";
import { Sparkles, ChevronRight, User, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AvatarUploader } from "@/app/profile/AvatarUploader";

/**
 * Admin profile main page — list-style menu (mirip /profile user app).
 *
 * Identity card di atas (avatar uploader + bio + hobi), lalu menu list ke
 * sub-pages. Logout ditangani via header dropdown saja.
 */
export default async function AdminProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Kelola foto, info pribadi, dan password akun kamu.
        </p>
      </div>

      {/* Identity card */}
      <Card className="p-5">
        <AvatarUploader
          initialAvatarUrl={profile.avatarUrl}
          displayName={profile.displayName}
        />
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <div className="space-y-0.5">
            <div className="text-base font-semibold">{profile.displayName}</div>
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
                Hobi & minat
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

      {/* Menu list */}
      <Card className="overflow-hidden divide-y divide-border">
        <MenuItem
          href="/admin/profile/account"
          icon={<User className="h-4 w-4" />}
          label="Account"
          description="Nama, nomor HP, tanggal lahir, bio, hobi"
        />
        <MenuItem
          href="/admin/profile/password"
          icon={<KeyRound className="h-4 w-4" />}
          label="Change Password"
          description="Ubah password admin panel"
        />
      </Card>
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
