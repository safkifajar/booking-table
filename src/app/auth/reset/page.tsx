import Link from "next/link";
import { verifyResetToken } from "@/lib/auth-v2/reset-password";
import { ResetForm } from "./ResetForm";

export const metadata = {
  title: "Set a new password",
};

// Token diperiksa tiap kali dibuka — jangan dilayani dari cache.
export const dynamic = "force-dynamic";

/**
 * Halaman menyetel password baru, dibuka dari tautan di email.
 *
 * Token diperiksa DI SERVER sebelum form tampil: tanpa itu tamu mengetikkan
 * password baru dulu, baru diberi tahu tautannya sudah kedaluwarsa.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token = "", email = "" } = await searchParams;
  const check = await verifyResetToken(token, email);

  return (
    <main
      className="relative flex-1 flex items-stretch justify-center px-6 pt-4 pb-5 overflow-hidden"
      style={{ background: "#8d1312" }}
    >
      <div className="relative z-10 w-full max-w-sm flex flex-col">
        {check.ok ? (
          <ResetForm token={token} email={email} />
        ) : (
          <div className="flex min-h-[calc(100dvh-4rem)] w-full flex-col">
            <div className="mt-4">
              <h1 className="text-2xl font-bold text-white">Link expired</h1>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                {check.error ?? "This reset link is no longer valid."} Reset
                links work once and expire after 30 minutes.
              </p>
            </div>
            <div className="mt-auto pt-6">
              <Link
                href="/auth/forgot"
                className="flex h-14 w-full items-center justify-center rounded-full bg-[#f0e6d2] text-base font-semibold text-[#8d1312] transition hover:bg-white"
              >
                Request a new link
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
