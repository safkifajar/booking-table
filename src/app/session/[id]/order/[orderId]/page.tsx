import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getOrderDetail } from "@/lib/actions";
import { OrderDetailView } from "./OrderDetailView";

interface PageProps {
  params: Promise<{ id: string; orderId: string }>;
}

/**
 * Halaman detail satu ORDER (multi-order): info order + item + history payment
 * + tombol Bayar (form + QRIS inline). (PRD Multi-Order Prepaid.)
 *
 * force-dynamic WAJIB: halaman ini disegarkan lewat SSE (useSessionRealtime di
 * OrderDetailView). Tanpanya router.refresh() mengambil ulang tapi dilayani
 * salinan cache, sehingga status pembayaran anggota & pembatalan order tak
 * pernah muncul — persis masalah yang sama pada /session/[id].
 */
export const dynamic = "force-dynamic";
export default async function OrderDetailPage({ params }: PageProps) {
  const { id, orderId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/session/${id}/order/${orderId}`)}`);
  }

  const detail = await getOrderDetail(id, orderId);
  if (!detail) notFound();

  return <OrderDetailView detail={detail} />;
}
