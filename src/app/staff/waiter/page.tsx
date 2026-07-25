import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import {
  getOrderQueueForWaiter,
  getServedItemsForWaiter,
  getActiveSessionsForWaiter,
  getAvailableTablesForWaiter,
  getReservationDataForWaiter,
  getBookingsForWaiter,
  getClosedSessionsForWaiter,
} from "@/lib/waiter-actions";
import { getMoveRequests } from "@/lib/move-approval-actions";
import {
  expireFinishedSessions,
  promoteDueReservations,
} from "@/lib/queries";
import { StaffProfileButton } from "@/components/staff/StaffProfileButton";
import { WaiterDashboard } from "./WaiterDashboard";
import { NotificationBell } from "@/components/NotificationBell";

// Selalu render dinamis: transisi status berbasis waktu (expireFinishedSessions
// / promoteDueReservations) HARUS jalan tiap kunjungan supaya sesi lewat-waktu
// pindah ke Selesai — jangan disajikan dari cache statis.
export const dynamic = "force-dynamic";

/**
 * Waiter dashboard — order queue + bantu pesan flow.
 * Allowed roles: waiter, manager, admin.
 */
export default async function StaffWaiterPage() {
  const ctx = await requireAnyRole(
    ["waiter", "manager", "admin"],
    "/staff/waiter"
  );

  // Transisi status berbasis waktu (lazy, tanpa cron) SEBELUM ambil list:
  // reservasi yg jamnya tiba → open; sesi yg jam selesainya lewat → overdue/closed.
  await expireFinishedSessions(ctx.barId);
  await promoteDueReservations(ctx.barId);

  const [
    bar,
    profile,
    queue,
    servedItems,
    sessions,
    availableTables,
    reservationData,
    bookings,
    moveRequests,
    closedSessions,
  ] = await Promise.all([
    db
      .select({ id: bars.id, name: bars.name })
      .from(bars)
      .where(eq(bars.id, ctx.barId))
      .then((r) => r[0]),
    getCurrentProfile(),
    getOrderQueueForWaiter(),
    getServedItemsForWaiter(),
    getActiveSessionsForWaiter(),
    getAvailableTablesForWaiter(),
    getReservationDataForWaiter(),
    getBookingsForWaiter(),
    getMoveRequests(),
    getClosedSessionsForWaiter(),
  ]);

  if (!bar) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-sm text-muted-foreground">Bar not found</p>
      </main>
    );
  }

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          {profile && (
            <StaffProfileButton
              displayName={profile.displayName}
              avatarUrl={profile.avatarUrl}
              role={ctx.role}
            />
          )}
          <div className="flex-1" />
          {profile && <NotificationBell userId={profile.id} />}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Suspense>
          <WaiterDashboard
            initialQueue={queue}
            initialServed={servedItems}
            initialSessions={sessions}
            initialAvailableTables={availableTables}
            reservationData={reservationData}
            initialBookings={bookings}
            moveRequests={moveRequests}
            closedSessions={closedSessions}
            barId={bar.id}
          />
        </Suspense>
      </div>
    </main>
  );
}
