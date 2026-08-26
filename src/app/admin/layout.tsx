import Image from "next/image";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { AdminSidebarNav, AdminMobileMenu } from "./AdminSidebarNav";
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
  // Guard: hanya admin/manager boleh masuk (redirect kalau bukan).
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
          {/* Mobile: hamburger → drawer berisi semua menu (pengganti bottom nav) */}
          <AdminMobileMenu role={bar.role} />
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-md overflow-hidden border border-border shrink-0">
              <Image
                src="/logo-soho.jpeg"
                alt="SOHO"
                width={36}
                height={36}
                className="h-full w-full object-cover"
              />
            </div>
            <h1 className="text-base font-semibold truncate leading-tight">
              Dashboard
            </h1>
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
          <AdminSidebarNav role={bar.role} />
        </aside>

        {/* Main — bottom nav dihapus, jadi tak perlu padding bawah ekstra. */}
        <main className="flex-1 min-w-0 py-6 pb-8">{children}</main>
      </div>
    </div>
  );
}
