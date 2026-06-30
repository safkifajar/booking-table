import Link from "next/link";
import { getCurrentProfile, getStaffRole } from "@/lib/auth-v2/current";
import { TrendingUp, ChefHat, ArrowRight } from "lucide-react";

/**
 * Server Component: tampilkan banner shortcut ke Admin / Staff Dashboard
 * kalau user yang login punya role staff_roles.
 * Tidak render apa-apa kalau user biasa / belum login.
 */
export async function StaffShortcut() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const staff = await getStaffRole();
  if (!staff) return null;

  const isAdminOrManager = staff.role === "admin" || staff.role === "manager";

  return (
    <div className="relative z-10 max-w-6xl mx-auto px-6 pt-4">
      <div className="rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3 sm:p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            {isAdminOrManager ? (
              <TrendingUp className="h-4 w-4 text-primary" />
            ) : (
              <ChefHat className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-primary/80">
              Staff access · {staff.role}
            </div>
            <div className="text-sm font-medium truncate">
              Welcome back, {profile.displayName}
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {isAdminOrManager && (
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 transition"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Admin Dashboard
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          <Link
            href="/staff"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-foreground text-xs font-semibold hover:bg-muted transition"
          >
            <ChefHat className="h-3.5 w-3.5" />
            Staff Dashboard
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
