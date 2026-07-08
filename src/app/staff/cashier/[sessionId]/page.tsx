import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * Halaman detail cashier lama SEKARANG dialihkan ke halaman sesi bersama
 * /session/[id] (SessionView penuh: tab Table/Menu/Bill/Pay) — sama seperti
 * waiter. `?from=/staff/cashier` supaya tombol back kembali ke daftar cashier.
 * Receipt tetap di sub-route /staff/cashier/[sessionId]/receipt.
 */
export default async function CashierSessionRedirect({ params }: PageProps) {
  const { sessionId } = await params;
  redirect(`/session/${sessionId}?from=/staff/cashier`);
}
