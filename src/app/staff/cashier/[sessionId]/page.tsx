import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { getSessionDetailForCashier } from "@/lib/cashier-actions";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { AdminHeaderProfile } from "@/app/admin/AdminHeaderProfile";
import { CashierSessionDetailView } from "./CashierSessionDetailView";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function CashierSessionPage({ params }: PageProps) {
  const { sessionId } = await params;
  const ctx = await requireAnyRole(
    ["cashier", "manager", "admin"],
    `/staff/cashier/${sessionId}`
  );

  const [detail, user, profile] = await Promise.all([
    getSessionDetailForCashier(sessionId),
    getCurrentUser(),
    getCurrentProfile(),
  ]);
  if (!detail) notFound();

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/staff/cashier" aria-label="Back to list">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-primary/70">
              Detail Meja
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {detail.table_label} · {detail.area_name}
            </h1>
          </div>
          {profile && (
            <AdminHeaderProfile
              displayName={profile.displayName}
              email={user?.email ?? ""}
              avatarUrl={profile.avatarUrl}
              profileHref="/staff/profile"
            />
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <CashierSessionDetailView detail={detail} barId={ctx.barId} />
      </div>
    </main>
  );
}
