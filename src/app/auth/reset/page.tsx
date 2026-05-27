import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ResetForm } from "./ResetForm";

export default async function ResetPasswordPage() {
  // User harus sudah login (via recovery link yang exchange code di /auth/callback)
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/forgot?error=session_expired");
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <Suspense>
        <ResetForm email={user.email ?? ""} />
      </Suspense>
    </main>
  );
}
