"use server";

/**
 * Server Actions untuk Staff Login (admin subdomain).
 *
 * Login berlaku untuk semua staff role (admin/manager/cashier/waiter).
 * Customer biasa (tidak punya staff_role) ditolak SEBELUM signIn — kita
 * verify password manual dulu + cek role, baru signIn supaya cookie tidak
 * pernah di-set untuk customer.
 *
 * Setelah sukses, redirect ke dashboard default sesuai role:
 * - admin/manager → /admin
 * - cashier → /staff/cashier
 * - waiter → /staff/waiter
 */

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db/client";
import { staffRoles } from "@/lib/db/schema/extras";
import { users } from "@/lib/db/schema/auth";
import { verifyPassword } from "@/lib/auth-v2/password";
import { adminLoginUrl } from "@/lib/auth-v2/permissions";
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
 * Flow lebih reliable:
 * 1. Lookup user by email (cek email valid + ambil hash)
 * 2. Verify password manual (constant-time via bcrypt)
 * 3. Cek staff_role (kalau bukan staff → reject)
 * 4. Baru panggil signIn (Auth.js bikin cookie)
 * 5. Redirect ke dashboard sesuai role
 *
 * Kenapa tidak signIn dulu lalu auth(): di Server Action context yang sama,
 * cookie yang baru di-set Auth.js belum visible ke auth() call berikutnya
 * (transaction context belum commit). Verify manual lebih reliable.
 */
export async function adminSignInAction(formData: {
  email: string;
  password: string;
  next?: string;
}): Promise<ActionResult> {
  const email = formData.email.toLowerCase().trim();
  const password = formData.password;

  try {
    // Step 1: Lookup user
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email));

    if (!user) {
      // Constant-time dummy hash verify untuk hindari user enumeration timing
      await verifyPassword(password, "$2b$10$dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy.D");
      return { ok: false, error: "Incorrect email or password" };
    }

    // Step 2: Verify password
    if (!user.passwordHash) {
      return {
        ok: false,
        error: "This account hasn't set a password. Check your invite email.",
      };
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return { ok: false, error: "Incorrect email or password" };
    }

    // Step 3: Cek staff role
    const [staff] = await db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.profileId, user.id), eq(staffRoles.isActive, true))
      );

    if (!staff) {
      return {
        ok: false,
        error: "This account doesn't have staff access",
      };
    }

    // Step 4: Sign in via Auth.js (set cookie). Karena password sudah di-verify
    // manual, signIn pasti sukses — tapi tetap pakai credentials provider supaya
    // session structure standar Auth.js (JWT claims, dst).
    await signIn("credentials", {
      identifier: email,
      password,
      redirect: false,
    });

    // Step 5: Redirect ke dashboard sesuai role.
    // Pakai Next.js redirect() (relative URL) supaya host current request
    // dipertahankan. Kalau pakai Auth.js redirectTo, dia bikin URL absolute
    // dari AUTH_URL env yang lost subdomain "admin.".
    const targetUrl =
      formData.next || defaultDashboardFor(staff.role as StaffRoleName);
    redirect(targetUrl);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error("[adminSignInAction] unexpected:", err);
    return { ok: false, error: "Login failed. Please try again" };
  }
}

/**
 * Admin sign out — clear session, lalu ke halaman login ADMIN.
 *
 * Kenapa URL ABSOLUT ke subdomain admin, bukan redirect("/login") relatif:
 * path relatif diselesaikan Next terhadap AUTH_URL (host customer), jadi
 * admin mendarat di halaman login CUSTOMER. Dengan menyusun host
 * "admin.<domain>" secara eksplisit, admin selalu kembali ke /login admin.
 *
 * Pola penyusunan host-nya sama dengan setup-password invite staff
 * (lib/staff-actions.ts).
 */
export async function adminSignOutAction(): Promise<void> {
  await signOut({ redirect: false });
  redirect(adminLoginUrl());
}
