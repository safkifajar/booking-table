import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { userHasPassword } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { PasswordSection } from "@/app/profile/PasswordSection";

export default async function StaffProfilePasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const hasPassword = await userHasPassword();

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/staff/profile" aria-label="Back to Profile">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-base sm:text-lg font-semibold">
              {hasPassword ? "Change Password" : "Set Password"}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <PasswordSection hasPassword={hasPassword} />
      </div>
    </main>
  );
}
