import Link from "next/link";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import {
  getActiveSessionsForCashier,
  getBookingsForCashier,
  getClosedSessionsForCashier,
  getCashierOrderQueue,
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
import { FileText, Users } from "lucide-react";
import { StaffProfileButton } from "@/components/staff/StaffProfileButton";
import { CashierSessionList } from "./CashierSessionList";
import { NotificationBell } from "@/components/NotificationBell";
import { getMoveRequests } from "@/lib/move-approval-actions";

// Selalu dinamis: expireFinishedSessions/promoteDueReservations HARUS jalan
// tiap kunjungan (sesi lewat-waktu → Selesai). Jangan disajikan dari cache.
export const dynamic = "force-dynamic";

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
    orderQueue,
  ] = await Promise.all([
    getActiveSessionsForCashier(),
    getBookingsForCashier(),
    getAvailableTablesForWaiter(),
    getReservationDataForWaiter(),
    getMoveRequests(),
    getClosedSessionsForCashier(),
    getCashierOrderQueue(),
  ]);

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

          {/* Ikon saja, gaya disamakan dgn tombol notifikasi (tanpa kotak
              border). Maksudnya tetap terbaca lewat aria-label & tooltip. */}
          <Link
            href="/staff/cashier/customers"
            aria-label="Customers"
            title="Customers"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted/60 transition text-muted-foreground hover:text-foreground"
          >
            <Users className="h-4 w-4" />
          </Link>
          <Link
            href="/staff/cashier/shift"
            aria-label="Transactions"
            title="Transactions"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted/60 transition text-muted-foreground hover:text-foreground"
          >
            <FileText className="h-4 w-4" />
          </Link>
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
          orderQueue={orderQueue}
          barId={ctx.barId}
        />
      </div>
    </main>
  );
}
