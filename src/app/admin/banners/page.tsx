import { requireAdmin } from "@/lib/admin";
import { getAllBannersForAdmin } from "@/lib/banner-actions";
import { BannerManager } from "./BannerManager";

export default async function AdminBannersPage() {
  const bar = await requireAdmin();
  const banners = await getAllBannersForAdmin(bar.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Banner Promo</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Banner carousel yang tampil di halaman utama. Tampil sesuai jadwal
          kalau di-set tanggal aktif, kalau tidak selalu tampil selama status
          aktif.
        </p>
      </div>

      <BannerManager barId={bar.id} initialBanners={banners} />
    </div>
  );
}
