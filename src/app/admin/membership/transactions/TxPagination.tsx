"use client";

import { useRouter } from "next/navigation";
import { Pagination } from "@/components/admin/Pagination";

/** Jembatan Pagination bersama (0-based, onChange) → URL ?page= (1-based). */
export function TxPagination({
  page,
  totalPages,
  status,
}: {
  page: number;
  totalPages: number;
  status?: string;
}) {
  const router = useRouter();
  return (
    <Pagination
      page={page - 1}
      totalPages={totalPages}
      onChange={(p) => {
        const params = new URLSearchParams({
          ...(status ? { status } : {}),
          page: String(p + 1),
        });
        router.push(`/admin/membership/transactions?${params.toString()}`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    />
  );
}
