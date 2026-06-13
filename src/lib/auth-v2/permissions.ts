import "server-only";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { staffRoles } from "@/lib/db/schema/extras";
import { getCurrentProfile } from "./current";

/**
 * Permission system untuk staff role-based access.
 *
 * Role hierarchy (low → high):
 *   waiter (1) < cashier (2) < manager (3) < admin (4)
 *
 * Convention:
 * - Higher role bisa do lower role's job
 * - Specific check: `can(role, "manage_menu")` untuk granular permission
 * - Require helper: `requireRole(["cashier", "manager", "admin"])` redirect kalau tidak
 *
 * Permission matrix di-define explicit di PERMISSIONS — single source of truth.
 */

export type StaffRoleName = "admin" | "manager" | "cashier" | "waiter";

/**
 * Permission keys — semua action yang butuh role gate.
 * Tambah disini kalau ada feature baru yang restricted.
 */
export type Permission =
  | "view_admin_dashboard" // /admin/* — laporan + manage banner/menu
  | "manage_menu" // CRUD menu items + categories
  | "manage_banner" // CRUD promo banner
  | "manage_staff" // assign role, deactivate user
  | "view_queue" // staff dashboard queue view
  | "update_order_status" // mark sent → preparing → served
  | "assist_order" // join session as virtual member to add items
  | "open_table_for_customer" // buka meja baru atas nama tamu (walk-in tanpa HP)
  | "receive_payment" // payShare action (terima bayar)
  | "close_session" // close meja (cashier action)
  | "view_shift_report" // lihat transaksi yang dia close hari ini
  | "view_all_reports"; // full analytics (admin/manager)

/**
 * Permission matrix per role. Boolean explicit — readable di review code.
 */
const PERMISSIONS: Record<StaffRoleName, Record<Permission, boolean>> = {
  admin: {
    view_admin_dashboard: true,
    manage_menu: true,
    manage_banner: true,
    manage_staff: true,
    view_queue: true,
    update_order_status: true,
    assist_order: true,
    open_table_for_customer: true,
    receive_payment: true,
    close_session: true,
    view_shift_report: true,
    view_all_reports: true,
  },
  manager: {
    view_admin_dashboard: true,
    manage_menu: true,
    manage_banner: true,
    manage_staff: false, // hanya admin yang bisa assign role
    view_queue: true,
    update_order_status: true,
    assist_order: true,
    open_table_for_customer: true,
    receive_payment: true,
    close_session: true,
    view_shift_report: true,
    view_all_reports: true,
  },
  cashier: {
    view_admin_dashboard: false,
    manage_menu: false,
    manage_banner: false,
    manage_staff: false,
    view_queue: false,
    update_order_status: false,
    assist_order: false,
    open_table_for_customer: true,
    receive_payment: true,
    close_session: true,
    view_shift_report: true,
    view_all_reports: false,
  },
  waiter: {
    view_admin_dashboard: false,
    manage_menu: false,
    manage_banner: false,
    manage_staff: false,
    view_queue: true,
    update_order_status: true,
    assist_order: true,
    open_table_for_customer: true,
    receive_payment: false,
    // Waiter bisa close meja TAPI cuma kalau sudah lunas. Server action
    // closeSession enforce guardrail ini berdasarkan role (lihat actions.ts).
    close_session: true,
    view_shift_report: false,
    view_all_reports: false,
  },
};

/**
 * Check permission untuk role.
 * Pure function — bisa dipakai client juga via prop drilling.
 */
export function can(
  role: StaffRoleName | null | undefined,
  permission: Permission
): boolean {
  if (!role) return false;
  return PERMISSIONS[role]?.[permission] ?? false;
}

/**
 * Default dashboard URL per role — dipakai untuk redirect setelah login
 * atau ketika user akses /staff tanpa specific role yang aktif.
 */
export function defaultDashboardFor(role: StaffRoleName): string {
  switch (role) {
    case "admin":
    case "manager":
      return "/admin";
    case "cashier":
      return "/staff/cashier";
    case "waiter":
      return "/staff/waiter";
  }
}

// ============================================================
// SERVER GUARDS
// ============================================================

/**
 * Require user logged in + punya salah satu role di whitelist.
 * Redirect ke /auth kalau anon, atau ke / kalau bukan role yang allowed.
 *
 * Return { profile, role, barId } kalau lolos.
 */
export async function requireAnyRole(
  allowedRoles: StaffRoleName[],
  nextPath: string
): Promise<{
  profileId: string;
  role: StaffRoleName;
  barId: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const [row] = await db
    .select({ role: staffRoles.role, barId: staffRoles.barId })
    .from(staffRoles)
    .where(
      and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
    );

  if (!row) {
    // Bukan staff sama sekali — kembali ke login (admin subdomain)
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const userRole = row.role as StaffRoleName;
  if (!allowedRoles.includes(userRole)) {
    // Punya role tapi tidak punya akses — redirect ke dashboard role-nya sendiri
    redirect(defaultDashboardFor(userRole));
  }

  return {
    profileId: profile.id,
    role: userRole,
    barId: row.barId,
  };
}

/**
 * Require specific permission. Redirect kalau tidak punya akses.
 */
export async function requirePermission(
  permission: Permission,
  nextPath: string
): Promise<{
  profileId: string;
  role: StaffRoleName;
  barId: string;
}> {
  const ctx = await requireStaffContext(nextPath);
  if (!can(ctx.role, permission)) {
    // Tidak punya permission — redirect ke dashboard role-nya
    redirect(defaultDashboardFor(ctx.role));
  }
  return ctx;
}

async function requireStaffContext(nextPath: string): Promise<{
  profileId: string;
  role: StaffRoleName;
  barId: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  const [row] = await db
    .select({ role: staffRoles.role, barId: staffRoles.barId })
    .from(staffRoles)
    .where(
      and(eq(staffRoles.profileId, profile.id), eq(staffRoles.isActive, true))
    );
  if (!row) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return {
    profileId: profile.id,
    role: row.role as StaffRoleName,
    barId: row.barId,
  };
}
