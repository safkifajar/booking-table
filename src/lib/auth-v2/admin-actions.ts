"use server";

/**
 * Server Actions untuk Staff Login (admin subdomain).
 *
 * Login berlaku untuk semua staff role (admin/manager/cashier/waiter).
 * Customer biasa (tidak punya staff_role) ditolak setelah signIn.
 *
 * Setelah sukses, redirect ke dashboard default sesuai role:
 * - admin/manager → /admin
 * - cashier → /staff/cashier
 * - waiter → /staff/waiter
 */

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { signIn, signOut, auth } from "@/auth";
import { db } from "@/lib/db/client";
import { staffRoles } from "@/lib/db/schema/extras";
import {
  defaultDashboardFor,
  type StaffRoleName,
} from "@/lib/auth-v2/permissions";

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Admin sign in dengan email+password, lalu verify staff role.
 *
 * Flow:
 * 1. signIn credentials (tanpa redirect supaya kita bisa cek role dulu)
 * 2. Ambil session — kalau gagal signIn, return error
 * 3. Lookup staff_roles — kalau bukan admin/manager, signOut + return error
 * 4. Redirect ke /admin (atau next)
 */
export async function adminSignInAction(formData: {
  email: string;
  password: string;
  next?: string;
}): Promise<ActionResult> {
  try {
    // Step 1: signIn dengan redirect: false supaya kita bisa cek role dulu
    await signIn("credentials", {
      email: formData.email.toLowerCase().trim(),
      password: formData.password,
      redirect: false,
    });

    // Step 2: cek session ada
    const session = await auth();
    if (!session?.user?.id) {
      return { ok: false, error: "Email atau password salah" };
    }

    // Step 3: cek staff role
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, session.user.id),
          eq(staffRoles.isActive, true)
        )
      );

    if (!staff) {
      // Bukan staff sama sekali — sign out + reject
      await signOut({ redirect: false });
      return {
        ok: false,
        error: "Akun ini tidak punya akses staff",
      };
    }

    // Step 4: sukses — redirect ke dashboard sesuai role.
    // Pakai Next.js redirect() (relative URL) supaya host current request
    // dipertahankan. Kalau pakai Auth.js redirectTo, dia bikin URL absolute
    // dari AUTH_URL env yang lost subdomain "admin.".
    const targetUrl =
      formData.next || defaultDashboardFor(staff.role as StaffRoleName);
    redirect(targetUrl);
  } catch (err) {
    if (isRedirectError(err)) throw err;

    const message = err instanceof Error ? err.message : "";
    if (message.includes("CredentialsSignin") || message.includes("credentials")) {
      return { ok: false, error: "Email atau password salah" };
    }
    console.error("[adminSignInAction] unexpected:", err);
    return { ok: false, error: "Login gagal — coba lagi" };
  }
}

/**
 * Admin sign out — clear session, redirect ke admin login.
 *
 * signOut() tidak redirect (redirect: false) supaya kita pakai
 * Next.js redirect() yang preserve host subdomain.
 */
export async function adminSignOutAction(): Promise<void> {
  await signOut({ redirect: false });
  redirect("/login");
}
