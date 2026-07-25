import { requireAdmin } from "@/lib/admin";
import { listCustomers, getCustomerStats } from "@/lib/customer-actions";
import { CustomerManager } from "./CustomerManager";

/**
 * Admin page: Manage Customer (user non-staff).
 * List + tambah + edit + hapus customer. Search + pagination.
 */
interface PageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    size?: string;
    status?: string;
    membership?: string;
    sort?: string;
  }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { q, page, size, status, membership, sort } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(size)) ? Number(size) : 10;
  const statusF =
    status === "active" || status === "inactive" ? status : "all";
  const membershipF =
    membership === "basic" || membership === "premium" || membership === "vip"
      ? membership
      : "all";
  const sortF =
    sort === "visit_desc" || sort === "visit_asc" ? sort : "default";
  const [{ rows, total }, stats] = await Promise.all([
    listCustomers(q, pageNum, pageSize, {
      status: statusF,
      membership: membershipF,
      sort: sortF,
    }),
    getCustomerStats(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Customer</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Registered customer accounts. You can add or edit them. Staff are
          managed separately in Manage Staff.
        </p>
      </div>

      <CustomerManager
        initialRows={rows}
        total={total}
        page={pageNum}
        pageSize={pageSize}
        query={q ?? ""}
        status={statusF}
        membership={membershipF}
        sort={sortF}
        stats={stats}
      />
    </div>
  );
}
