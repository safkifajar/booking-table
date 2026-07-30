import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { listCustomersForStaff } from "@/lib/staff-customer-actions";
import { CashierCustomerList } from "./CashierCustomerList";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

/**
 * Kelola pelanggan dari sisi kasir — cari, tambah (untuk tamu yang tak bawa
 * HP), dan ubah data pelanggan. Waiter tak punya akses (permission
 * manage_customers); guard halaman pakai role explicit.
 */
export default async function CashierCustomersPage({ searchParams }: PageProps) {
  await requireAnyRole(
    ["cashier", "manager", "admin"],
    "/staff/cashier/customers"
  );

  const { q, page } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = 20;
  const { rows, total } = await listCustomersForStaff(q, pageNum, pageSize);

  return (
    <main className="flex-1 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/staff/cashier"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">Customers</h1>
            <p className="text-[11px] text-muted-foreground">
              {total} registered customer{total === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3">
        <CashierCustomerList
          initialRows={rows}
          total={total}
          page={pageNum}
          pageSize={pageSize}
          query={q ?? ""}
        />
      </div>
    </main>
  );
}
