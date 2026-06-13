/**
 * Server-side auth helpers — mirror API dari Supabase version (src/lib/auth.ts)
 * supaya pages/actions bisa migrate dengan sedikit perubahan import.
 *
 * Usage:
 *   import { getCurrentProfile, requireProfile, requireAdmin } from "@/lib/auth-v2";
 *
 * Semua function ini "server-only" — tidak boleh dipanggil dari Client Components.
 *
 * Difference dari Supabase version:
 * - Auth.js return session object (bukan user object langsung)
 * - User ID di session.user.id (kita inject lewat JWT callback di src/auth.ts)
 * - Profile fetch via Drizzle bukan Supabase client
 */

import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema/profiles";
import { users } from "@/lib/db/schema/auth";
import { staffRoles } from "@/lib/db/schema/extras";

// ============================================================
// TYPES
// ============================================================

/**
 * User identity dari Auth.js session.
 * Minimal data — kalau butuh display name / avatar, pakai getCurrentProfile().
 */
export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Profile = business data per user.
 * 1-to-1 dengan auth user (profiles.id = users.id).
 */
export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  phone: string | null;
  birthDate: string | null; // ISO date "YYYY-MM-DD"
  bio: string | null;
  hobbies: string[];
  createdAt: Date;
}

/**
 * Staff role context — pakai requireAdmin() untuk admin pages.
 */
export interface StaffContext {
  profile: Profile;
  role: "admin" | "manager" | "cashier" | "waiter";
  barId: string;
  barSlug: string;
  barName: string;
}

// ============================================================
// SOFT HELPERS (return null kalau tidak login)
// ============================================================

/**
 * Ambil current authenticated user.
 * Return null kalau belum login.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
  };
}

/**
 * Ambil current profile (display name, avatar, hobbies).
 * Return null kalau belum login atau profile belum di-create.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const row = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  });
  if (!row) return null;

  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    phone: row.phone,
    birthDate: row.birthDate,
    bio: row.bio,
    hobbies: row.hobbies,
    createdAt: row.createdAt,
  };
}

// ============================================================
// HARD HELPERS (redirect kalau tidak login / unauthorized)
// ============================================================

/**
 * Require user — redirect ke /auth kalau belum login.
 * Return AuthUser.
 *
 * @param nextPath - path untuk back redirect setelah login (default "/")
 */
export async function requireUser(nextPath = "/"): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}

/**
 * Require profile — redirect kalau belum login atau profile belum ada.
 * 99% page customer pakai ini.
 */
export async function requireProfile(nextPath = "/"): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(nextPath)}`);
  }
  return profile;
}

/**
 * Require admin/manager — redirect ke / kalau user tidak punya role staff.
 *
 * Bedanya dengan Supabase version (yang ada di lib/admin.ts):
 * - Mirror signature: throw via redirect, tidak return null
 * - Default redirect ke "/" (bukan /admin lagi karena yang di-block)
 * - Return semua bar context biar admin pages bisa pakai
 */
export async function requireAdmin(nextPath = "/admin"): Promise<StaffContext> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  // Cek apakah user punya role staff (apapun role-nya)
  const anyRole = await db.query.staffRoles.findFirst({
    where: (sr, { and, eq }) =>
      and(eq(sr.profileId, profile.id), eq(sr.isActive, true)),
    with: {
      bar: {
        columns: { id: true, slug: true, name: true },
      },
    },
  });

  if (!anyRole) {
    // Bukan staff sama sekali — redirect ke login
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  // Punya role tapi bukan admin/manager → redirect ke dashboard role-nya
  // (cashier → /staff/cashier, waiter → /staff/waiter)
  if (anyRole.role !== "admin" && anyRole.role !== "manager") {
    const dashboard =
      anyRole.role === "cashier" ? "/staff/cashier" : "/staff/waiter";
    redirect(dashboard);
  }

  return {
    profile,
    role: anyRole.role as "admin" | "manager",
    barId: anyRole.bar.id,
    barSlug: anyRole.bar.slug,
    barName: anyRole.bar.name,
  };
}

/**
 * Require staff (any role: admin, manager, waiter) — untuk /staff dashboard.
 */
export async function requireStaff(nextPath = "/staff"): Promise<StaffContext> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(nextPath)}`);
  }

  const row = await db.query.staffRoles.findFirst({
    where: (sr, { and, eq }) =>
      and(eq(sr.profileId, profile.id), eq(sr.isActive, true)),
    with: {
      bar: {
        columns: { id: true, slug: true, name: true },
      },
    },
  });

  if (!row) {
    redirect("/");
  }

  return {
    profile,
    role: row.role,
    barId: row.bar.id,
    barSlug: row.bar.slug,
    barName: row.bar.name,
  };
}

/**
 * Internal helper: ambil staff role tanpa redirect.
 * Untuk UI conditional render (misalnya UserMenu dropdown).
 *
 * Return null kalau bukan staff.
 */
export type StaffRoleName = "admin" | "manager" | "cashier" | "waiter";

export async function getStaffRole(): Promise<{
  role: StaffRoleName;
  barId: string;
} | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const row = await db.query.staffRoles.findFirst({
    where: (sr, { and, eq }) =>
      and(eq(sr.profileId, profile.id), eq(sr.isActive, true)),
    columns: { role: true, barId: true },
  });

  if (!row) return null;

  return {
    role: row.role,
    barId: row.barId,
  };
}

// Re-export `users` for callers needing raw schema (rare)
export { users };
