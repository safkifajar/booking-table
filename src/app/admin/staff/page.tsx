import { requireAdmin } from "@/lib/admin";
import { listStaffForBar } from "@/lib/staff-actions";
import { StaffManager } from "./StaffManager";

/**
 * Admin page: Manage Staff.
 * Bisa assign role baru ke user, ubah role, deactivate.
 *
 * Cuma admin yang lolos (permission "manage_staff" check di server actions).
 * Manager juga lolos requireAdmin tapi gagal di action — UI tampilkan
 * tombol disabled untuk manager (future improvement).
 */
export default async function AdminStaffPage() {
  const bar = await requireAdmin();
  const staff = await listStaffForBar(bar.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Staff</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Assign staff roles to users. A user must sign up in the app (via
          email) before they can be assigned. Available roles: waiter, cashier,
          manager, admin.
        </p>
      </div>

      <StaffManager barId={bar.id} initialStaff={staff} currentRole={bar.role} />
    </div>
  );
}
