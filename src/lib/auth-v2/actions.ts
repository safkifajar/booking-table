"use server";

/**
 * Server Actions untuk auth flow — dipanggil dari UI (AuthForm.tsx).
 *
 * Wrapper di atas:
 * - signup() helper untuk create user + profile
 * - signIn() dari Auth.js untuk credentials + magic link
 * - signOut() dari Auth.js
 *
 * Semua action return { ok, error } shape supaya UI gampang handle.
 * Tidak throw — error di-catch & jadi return value.
 *
 * NOTE: signIn() dengan redirect:true akan throw NEXT_REDIRECT — itu BUKAN error,
 * itu mekanisme Next.js untuk trigger client-side redirect. Re-throw supaya
 * Next.js handle, tapi catch error lain.
 */

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { signIn, signOut } from "@/auth";
import { signup, SignupError } from "./signup";

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Signup credentials baru — create user + profile, lalu auto-signin.
 *
 * Kalau sukses, signIn() trigger NEXT_REDIRECT ke `next` (default "/"),
 * jadi action ini secara teknis tidak return ke caller pas success.
 * UI tetap dapet { ok: true } HANYA kalau redirect:false (untuk test).
 */
export async function signUpAction(formData: {
  email: string;
  password: string;
  displayName: string;
  username: string;
  phone?: string;
  next?: string;
}): Promise<ActionResult> {
  try {
    await signup({
      email: formData.email,
      password: formData.password,
      displayName: formData.displayName,
      username: formData.username,
      phone: formData.phone,
    });

    // Auto signin → lanjut ke wizard onboarding (step 2-3). next disimpan
    // supaya setelah onboarding selesai bisa diarahkan ke tujuan awal.
    const onboardingUrl =
      formData.next && formData.next !== "/"
        ? `/onboarding?next=${encodeURIComponent(formData.next)}`
        : "/onboarding";
    await signIn("credentials", {
      identifier: formData.email.toLowerCase().trim(),
      password: formData.password,
      redirectTo: onboardingUrl,
    });

    return { ok: true };
  } catch (err) {
    // NEXT_REDIRECT harus di-re-throw (bukan error)
    if (isRedirectError(err)) throw err;

    if (err instanceof SignupError) {
      return { ok: false, error: err.message };
    }
    console.error("[signUpAction] unexpected:", err);
    return { ok: false, error: "Failed to create account. Please try again." };
  }
}

/**
 * Sign in credentials existing user.
 * Sukses → redirect (throw NEXT_REDIRECT).
 * Gagal → { ok: false, error }.
 */
export async function signInAction(formData: {
  identifier: string;
  password: string;
  next?: string;
}): Promise<ActionResult> {
  try {
    await signIn("credentials", {
      identifier: formData.identifier.toLowerCase().trim(),
      password: formData.password,
      redirectTo: formData.next ?? "/",
    });
    return { ok: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;

    // Auth.js wrap credentials failure jadi AuthError dengan type CredentialsSignin.
    // `code` dari subclass (mis. account_disabled) dibawa di err.code / err.cause.
    const code =
      (err as { code?: string })?.code ??
      (err as { cause?: { err?: { code?: string } } })?.cause?.err?.code;
    if (code === "account_disabled") {
      return {
        ok: false,
        error:
          "Your account is inactive. Please contact an admin to reactivate it.",
      };
    }

    const message = err instanceof Error ? err.message : "";
    if (message.includes("CredentialsSignin") || message.includes("credentials")) {
      return { ok: false, error: "Incorrect email/username or password" };
    }
    console.error("[signInAction] unexpected:", err);
    return { ok: false, error: "Failed to sign in. Please try again." };
  }
}

/**
 * Sign in via magic link — kirim email berisi callback URL.
 * Sukses → redirect ke verifyRequest page ("/auth?check_email=1").
 */
export async function magicLinkAction(formData: {
  email: string;
  next?: string;
}): Promise<ActionResult> {
  try {
    await signIn("resend", {
      email: formData.email.toLowerCase().trim(),
      redirectTo: formData.next ?? "/",
    });
    return { ok: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error("[magicLinkAction] unexpected:", err);
    return { ok: false, error: "Failed to send magic link. Please try again." };
  }
}

/**
 * Sign out — clear session, redirect ke landing.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
