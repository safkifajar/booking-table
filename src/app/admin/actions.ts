"use server";

import { requireAdmin, getTransactionDetail, type TransactionDetail } from "@/lib/admin";

export async function fetchTransactionDetail(
  sessionId: string
): Promise<TransactionDetail | null> {
  const bar = await requireAdmin();
  return getTransactionDetail(bar.id, sessionId);
}
