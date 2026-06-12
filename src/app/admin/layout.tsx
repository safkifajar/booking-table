import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { TrendingUp, Settings } from "lucide-react";
import { AdminSidebarNav, AdminMobileNav } from "./AdminSidebarNav";
import { AdminHeaderProfile } from "./AdminHeaderProfile";

/**
 * Layout admin panel.
 *
 * Diakses dari subdomain admin.* (lihat src/middleware.ts subdomain rewrite).
 * Header tidak punya link "back to app" — admin panel berdiri sendiri.
 * Logout button → adminSignOutAction → redirect ke admin login.
 *
 * Layout: header full-width, body container max-w-7xl. Sidebar + main
 * content sejajar dengan header dalam container yang sama supaya tidak
 * terlihat "kiri sendiri".
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const bar = await requireAdmin();
  const [user, profile] = await Promise.all([
    getCurrentUser(),
    getCurrentProfile(),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-primary/70">
                Admin Panel · {bar.role}
              </div>
              <h1 className="text-sm font-semibold truncate leading-tight">
                {bar.name}
              </h1>
            </div>
          </div>
          <div className="flex-1" />
          {profile && (
            <AdminHeaderProfile
              displayName={profile.displayName}
              email={user?.email ?? ""}
              avatarUrl={profile.avatarUrl}
            />
          )}
        </div>
      </header>

      {/* Body container — semua content (sidebar + main) sejajar dengan header */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 flex gap-6">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex w-56 flex-col py-6 shrink-0 sticky top-[57px] h-[calc(100vh-57px)]">
          <AdminSidebarNav />

          <div className="mt-auto pt-4 border-t border-border space-y-1">
            <Link
              href="/staff"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <Settings className="h-3.5 w-3.5" /> Staff Dashboard
            </Link>
          </div>
        </aside>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border flex">
          <AdminMobileNav />
        </nav>

        {/* Main */}
        <main className="flex-1 min-w-0 pb-20 md:pb-8 py-6">{children}</main>
      </div>
    </div>
  );
}
