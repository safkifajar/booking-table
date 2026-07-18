"use client";

import { useRouter } from "next/navigation";
import { Pagination } from "@/components/admin/Pagination";
import { Select } from "@/components/ui/select";

/**
 * Footer list transaksi membership: per-page select + Pagination bersama
 * (pola ItemsList). SELALU tampil meski datanya sedikit — permintaan user.
 * Jembatan: Pagination 0-based → URL ?page= (1-based) & ?per=.
 */
export function TxPagination({
  page,
  totalPages,
  perPage,
  status,
}: {
  page: number;
  totalPages: number;
  perPage: number;
  status?: string;
}) {
  const router = useRouter();

  function go(p: number, per: number) {
    const params = new URLSearchParams({
      ...(status ? { status } : {}),
      page: String(p),
      per: String(per),
    });
    router.push(`/admin/membership/transactions?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-border">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Per page:</span>
        <Select
          value={String(perPage)}
          onChange={(v) => go(1, Number(v))}
          options={[
            { value: "10", label: "10" },
            { value: "25", label: "25" },
            { value: "50", label: "50" },
            { value: "100", label: "100" },
          ]}
          ariaLabel="Per page"
        />
      </label>
      <Pagination
        page={page - 1}
        totalPages={Math.max(1, totalPages)}
        onChange={(p) => go(p + 1, perPage)}
      />
    </div>
  );
}
