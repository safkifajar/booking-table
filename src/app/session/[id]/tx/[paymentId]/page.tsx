import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getSessionPaymentDetail } from "@/lib/actions";
import { TransactionDetailView } from "./TransactionDetailView";

interface PageProps {
  params: Promise<{ id: string; paymentId: string }>;
}

/**
 * Halaman detail satu transaksi pembayaran dalam sesi.
 * Menampilkan: status, list item yang dibayar, tax & service, dan QRIS (kalau
 * pending & pemanggil = pemilik/staff). Referensi UI: struk transaksi Duitku.
 */
export default async function TransactionDetailPage({ params }: PageProps) {
  const { id, paymentId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/session/${id}/tx/${paymentId}`)}`);
  }

  const detail = await getSessionPaymentDetail(id, paymentId);
  if (!detail) notFound();

  return (
    <TransactionDetailView sessionId={id} detail={detail} />
  );
}
