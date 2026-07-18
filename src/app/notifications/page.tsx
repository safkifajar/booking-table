import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile, getStaffRole } from "@/lib/auth-v2/current";
import { getNotifications } from "@/lib/notifications";
import { SohoGlow } from "@/components/ui/soho-glow";
import { NotificationsList } from "./NotificationsList";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/notifications");
  }
  // Onboarding wizard HANYA untuk customer. Staff (kasir/waiter/manager/admin)
  // tak pernah "onboarded" tapi tetap boleh buka notifikasi — jangan pantulkan
  // ke form onboarding customer.
  const staffRole = await getStaffRole();
  if (!staffRole && !profile.onboarded) {
    redirect("/onboarding");
  }

  const initial = await getNotifications(50);

  return (
    <main className="relative flex-1 pb-24">
      <SohoGlow />
      {/* Header ala mobile app: back + judul */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-base font-semibold">Notifications</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5">
        <NotificationsList userId={profile.id} initial={initial} />
      </div>
    </main>
  );
}
