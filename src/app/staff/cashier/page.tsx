import Link from "next/link";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import {
  getActiveSessionsForCashier,
  getBookingsForCashier,
  getClosedSessionsForCashier,
} from "@/lib/cashier-actions";
import {
  getAvailableTablesForWaiter,
  getReservationDataForWaiter,
} from "@/lib/waiter-actions";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import {
  expireFinishedSessions,
  promoteDueReservations,
} from "@/lib/queries";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaffProfileButton } from "@/components/staff/StaffProfileButton";
import { CashierSessionList } from "./CashierSessionList";
import { NotificationBell } from "@/components/NotificationBell";
import { getMoveRequests } from "@/lib/move-approval-actions";

/**
 * Cashier dashboard utama.
 * Allowed roles: cashier, manager, admin.
 *
 * Layout: header + quick stats + search + list meja aktif (clickable
 * ke /staff/cashier/[sessionId] untuk detail bill + payment).
 */
export default async function CashierPage() {
  const ctx = await requireAnyRole(
    ["cashier", "manager", "admin"],
    "/staff/cashier"
  );

  const [bar, profile] = await Promise.all([
    db
      .select({ id: bars.id, name: bars.name })
      .from(bars)
      .where(eq(bars.id, ctx.barId))
      .then((rows) => rows[0]),
    getCurrentProfile(),
  ]);
  if (!bar) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-sm text-muted-foreground">Bar not found</p>
      </main>
    );
  }

  // Transisi status berbasis waktu (lazy, tanpa cron) SEBELUM ambil list:
  // reservasi yg jamnya tiba → open; sesi yg jam selesainya lewat → overdue/closed.
  await expireFinishedSessions(ctx.barId);
  await promoteDueReservations(ctx.barId);

  const [
    sessions,
    bookings,
    availableTables,
    reservationData,
    moveRequests,
    closedSessions,
  ] = await Promise.all([
    getActiveSessionsForCashier(),
    getBookingsForCashier(),
    getAvailableTablesForWaiter(),
    getReservationDataForWaiter(),
    getMoveRequests(),
    getClosedSessionsForCashier(),
  ]);

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          {profile && (
            <StaffProfileButton
              displayName={profile.displayName}
              avatarUrl={profile.avatarUrl}
            />
          )}
          <div className="flex-1" />

          <Button asChild variant="outline" size="sm">
            <Link href="/staff/cashier/shift">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Shift Report</span>
              <span className="sm:hidden">Shift</span>
            </Link>
          </Button>
          {profile && <NotificationBell userId={profile.id} />}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <CashierSessionList
          sessions={sessions}
          bookings={bookings}
          availableTables={availableTables}
          reservationData={reservationData}
          moveRequests={moveRequests}
          closedSessions={closedSessions}
          barId={ctx.barId}
        />
      </div>
    </main>
  );
}
