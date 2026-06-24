import Link from "next/link";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import {
  getActiveSessionsForCashier,
  getBookingsForCashier,
} from "@/lib/cashier-actions";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { eq } from "drizzle-orm";
import { Wallet, QrCode, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminHeaderProfile } from "@/app/admin/AdminHeaderProfile";
import { CashierSessionList } from "./CashierSessionList";

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

  const [bar, user, profile] = await Promise.all([
    db
      .select({ id: bars.id, name: bars.name })
      .from(bars)
      .where(eq(bars.id, ctx.barId))
      .then((rows) => rows[0]),
    getCurrentUser(),
    getCurrentProfile(),
  ]);
  if (!bar) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-sm text-muted-foreground">Bar tidak ditemukan</p>
      </main>
    );
  }

  const [sessions, bookings] = await Promise.all([
    getActiveSessionsForCashier(),
    getBookingsForCashier(),
  ]);

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-primary/70">
              Kasir Dashboard · {ctx.role}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {bar.name}
            </h1>
          </div>

          <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
            <Link href="/staff/qr">
              <QrCode className="h-4 w-4" /> QR
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/staff/cashier/shift">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Shift Report</span>
              <span className="sm:hidden">Shift</span>
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
        <CashierSessionList
          sessions={sessions}
          bookings={bookings}
          barId={ctx.barId}
        />
      </div>
    </main>
  );
}
