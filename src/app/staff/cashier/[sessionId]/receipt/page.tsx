import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { getSessionDetailForCashier } from "@/lib/cashier-actions";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ReceiptView } from "./ReceiptView";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * Receipt page — tampil setelah cashier close meja.
 * Format 80mm thermal printer compatible, plus tombol Print.
 *
 * Full implementation print formatting akan di-detail di task
 * "Receipt printable page" (todo terpisah). Sekarang minimal:
 * preview struk + tombol Print pakai browser dialog.
 */
export default async function ReceiptPage({ params }: PageProps) {
  const { sessionId } = await params;
  await requireAnyRole(
    ["cashier", "manager", "admin"],
    `/staff/cashier/${sessionId}/receipt`
  );

  const detail = await getSessionDetailForCashier(sessionId);
  if (!detail) notFound();

  return (
    <main className="flex-1 pb-12 print:pb-0">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md print:hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/staff/cashier" aria-label="Back to list">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {detail.table_label} · {detail.area_name}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <ReceiptView detail={detail} />
      </div>
    </main>
  );
}
