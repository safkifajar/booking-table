import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SetupPasswordForm } from "./SetupPasswordForm";

/**
 * Setup password page — diakses dari email staff invite.
 *
 * URL: admin.bookingsoho.com/setup-password?token=xxx&email=xxx
 *
 * Public — tidak butuh auth (user belum punya password). Setelah submit,
 * password di-set dan user di-redirect ke /login untuk sign in.
 */
export default async function SetupPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;

  if (!token || !email) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <Suspense>
        <SetupPasswordForm token={token} email={email} />
      </Suspense>
    </main>
  );
}
