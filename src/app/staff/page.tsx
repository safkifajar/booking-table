import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { getCurrentProfile, getStaffRole } from "@/lib/auth-v2/current";
import { defaultDashboardFor } from "@/lib/auth-v2/permissions";

/**
 * Gateway `/staff` — redirect ke dashboard sesuai role:
 * - admin / manager → /admin (subdomain admin sebenarnya, tapi kalau di domain
 *   utama lewat /staff, kita arahkan ke /admin yang akan 404 di domain utama)
 * - cashier → /staff/cashier
 * - waiter → /staff/waiter
 *
 * Kalau tidak punya role staff → tampilkan "Akses ditolak" card.
 */
export default async function StaffPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/staff");
  }

  const staff = await getStaffRole();
  if (!staff) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="max-w-md text-center p-8">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-2">Akses Staff Diperlukan</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Halaman ini hanya untuk staff bar. Hubungi manager kalau kamu butuh
            akses.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Kembali ke beranda</Link>
          </Button>
        </Card>
      </main>
    );
  }

  // Redirect ke default dashboard sesuai role
  redirect(defaultDashboardFor(staff.role));
}
