import { Suspense } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import {
  getOrderQueueForWaiter,
  getActiveSessionsForWaiter,
  getAvailableTablesForWaiter,
  getReservationDataForWaiter,
  getBookingsForWaiter,
} from "@/lib/waiter-actions";
import { Button } from "@/components/ui/button";
import { ChefHat, QrCode } from "lucide-react";
import { AdminHeaderProfile } from "@/app/admin/AdminHeaderProfile";
import { WaiterDashboard } from "./WaiterDashboard";

/**
 * Waiter dashboard — order queue + bantu pesan flow.
 * Allowed roles: waiter, manager, admin.
 */
export default async function StaffWaiterPage() {
  const ctx = await requireAnyRole(
    ["waiter", "manager", "admin"],
    "/staff/waiter"
  );

  const [
    bar,
    user,
    profile,
    queue,
    sessions,
    availableTables,
    reservationData,
    bookings,
  ] = await Promise.all([
    db
      .select({ id: bars.id, name: bars.name })
      .from(bars)
      .where(eq(bars.id, ctx.barId))
      .then((r) => r[0]),
    getCurrentUser(),
    getCurrentProfile(),
    getOrderQueueForWaiter(),
    getActiveSessionsForWaiter(),
    getAvailableTablesForWaiter(),
    getReservationDataForWaiter(),
    getBookingsForWaiter(),
  ]);

  if (!bar) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-sm text-muted-foreground">Bar tidak ditemukan</p>
      </main>
    );
  }

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <ChefHat className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-primary/70">
              Waiter Dashboard · {ctx.role}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {bar.name}
            </h1>
          </div>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex"
          >
            <Link href="/staff/qr">
              <QrCode className="h-4 w-4" /> QR
            </Link>
          </Button>
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

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Suspense>
          <WaiterDashboard
            initialQueue={queue}
            initialSessions={sessions}
            initialAvailableTables={availableTables}
            reservationData={reservationData}
            initialBookings={bookings}
            barId={bar.id}
          />
        </Suspense>
      </div>
    </main>
  );
}
