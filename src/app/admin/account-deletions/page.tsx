import { requireAdmin } from "@/lib/admin";
import { getAccountDeletionRequests } from "@/lib/account-deletion-actions";
import { AccountDeletionsManager } from "./AccountDeletionsManager";

// Daftar live (status berubah saat di-approve/reject) → selalu dinamis.
export const dynamic = "force-dynamic";

/**
 * Admin: pengajuan hapus akun customer. Approve = nonaktifkan akun (soft
 * delete); reject = biarkan aktif. Pending dulu.
 */
export default async function AdminAccountDeletionsPage() {
  await requireAdmin();
  const requests = await getAccountDeletionRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account Deletions</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Customer requests to delete their account. Approving deactivates the
          account (they can no longer sign in) — their past transactions are
          kept for records. Nothing is permanently erased.
        </p>
      </div>

      <AccountDeletionsManager requests={requests} />
    </div>
  );
}
