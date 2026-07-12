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
 */
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
