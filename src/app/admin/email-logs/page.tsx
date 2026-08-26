import { getEmailLogs } from "@/lib/email-log-actions";
import { EmailLogList } from "./EmailLogList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Email Log",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    size?: string;
    status?: string;
  }>;
}

/**
 * Catatan pengiriman email — "email mana yang benar-benar terkirim, kapan,
 * dan kalau gagal kenapa".
 *
 * getEmailLogs() menolak selain admin (bukan manager/kasir/waiter): log ini
 * memuat alamat email seluruh tamu & isi email reset password.
 */
export default async function AdminEmailLogsPage({ searchParams }: PageProps) {
  const { q, page, size, status } = await searchParams;

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = [10, 20, 50, 100].includes(Number(size)) ? Number(size) : 10;

  const { rows, total, counts, forbidden } = await getEmailLogs({
    page: pageNum,
    perPage: pageSize,
    search: q,
    status,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Email Log</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every email the app tried to send — delivery status and the error
          details when one fails.
        </p>
      </div>

      {forbidden ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium">Admins only</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This log contains guest email addresses and password reset links,
            so it&apos;s limited to admin accounts.
          </p>
        </div>
      ) : (
        <EmailLogList
          rows={rows}
          total={total}
          counts={counts}
          page={pageNum}
          pageSize={pageSize}
          search={q ?? ""}
          status={status ?? "all"}
        />
      )}
    </div>
  );
}
