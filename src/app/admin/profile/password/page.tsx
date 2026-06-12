import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { userHasPassword } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { PasswordSection } from "@/app/profile/PasswordSection";

export default async function AdminProfilePasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const hasPassword = await userHasPassword();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/admin/profile" aria-label="Kembali ke Profile">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-primary/70">
            Security
          </div>
          <h1 className="text-2xl font-bold">
            {hasPassword ? "Change Password" : "Set Password"}
          </h1>
        </div>
      </div>

      <div className="max-w-2xl">
        <PasswordSection hasPassword={hasPassword} />
      </div>
    </div>
  );
}
