import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { defaultDashboardFor, type StaffRoleName } from "@/lib/auth-v2/permissions";
import { AdminLoginForm } from "./AdminLoginForm";

/**
 * Admin login page — diakses dari subdomain admin.* lewat middleware
 * rewrite /login → /admin-login.
 *
 * Login support semua staff role (admin/manager/cashier/waiter). Setelah
 * login, auto-redirect ke dashboard default sesuai role.
 *
 * Customer biasa (non-staff) yang login → ditolak setelah signIn (di
 * adminSignInAction) supaya tidak punya cookie aktif di subdomain admin.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; email?: string }>;
}) {
  const session = await auth();
  const { next, error, email } = await searchParams;

  // Sudah login → cek staff role, redirect ke dashboard sesuai
  if (session?.user?.id) {
    const { db } = await import("@/lib/db/client");
    const { staffRoles } = await import("@/lib/db/schema/extras");
    const { and, eq } = await import("drizzle-orm");

    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, session.user.id),
          eq(staffRoles.isActive, true)
        )
      );

    if (staff) {
      const target = next || defaultDashboardFor(staff.role as StaffRoleName);
      redirect(target);
    }
    // User login tapi bukan staff — biarin di login page (form akan show error)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <Suspense>
        <AdminLoginForm next={next} initialError={error} initialEmail={email} />
      </Suspense>
    </main>
  );
}
