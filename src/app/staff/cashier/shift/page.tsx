import Link from "next/link";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { getShiftReport } from "@/lib/cashier-actions";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { AdminHeaderProfile } from "@/app/admin/AdminHeaderProfile";
import { ShiftReportView } from "./ShiftReportView";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function CashierShiftPage({ searchParams }: PageProps) {
  await requireAnyRole(
    ["cashier", "manager", "admin"],
    "/staff/cashier/shift"
  );

  const { from, to } = await searchParams;
  const [user, profile] = await Promise.all([
    getCurrentUser(),
    getCurrentProfile(),
  ]);

  // Default: hari ini (00:00 → 23:59 Jakarta time = UTC+7)
  const now = new Date();
  const TZ_OFFSET = 7 * 60 * 60 * 1000;
  const nowJkt = new Date(now.getTime() + TZ_OFFSET);
  const startJkt = new Date(
    Date.UTC(
      nowJkt.getUTCFullYear(),
      nowJkt.getUTCMonth(),
      nowJkt.getUTCDate()
    )
  );
  const startUtc = new Date(startJkt.getTime() - TZ_OFFSET);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  const fromIso = from
    ? new Date(`${from}T00:00:00+07:00`).toISOString()
    : startUtc.toISOString();
  const toIso = to
    ? new Date(
        new Date(`${to}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000
      ).toISOString()
    : endUtc.toISOString();

  const { summary, transactions } = await getShiftReport(fromIso, toIso);

  const defaultFromDate = (from ?? fromIso.slice(0, 10));
  const defaultToDate = (to ?? toIso.slice(0, 10));

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/staff/cashier" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-primary/70">
              Shift Report
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              Transactions
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

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <ShiftReportView
          summary={summary}
          transactions={transactions}
          defaultFromDate={defaultFromDate}
          defaultToDate={defaultToDate}
        />
      </div>
    </main>
  );
}
