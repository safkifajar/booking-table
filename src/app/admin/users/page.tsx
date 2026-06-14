import { requireAdmin } from "@/lib/admin";
import { listCustomers } from "@/lib/customer-actions";
import { CustomerManager } from "./CustomerManager";

/**
 * Admin page: Manage Customer (user non-staff).
 * List + tambah + edit + hapus customer. Search + pagination.
 */
interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { q, page } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const { rows, total } = await listCustomers(q, pageNum);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Customer</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Data customer yang sudah terdaftar. Bisa tambah, edit, atau hapus
          akun. Staff dikelola terpisah di Manage Staff.
        </p>
      </div>

      <CustomerManager
        initialRows={rows}
        total={total}
        page={pageNum}
        query={q ?? ""}
      />
    </div>
  );
}
