import { requireAdmin } from "@/lib/admin";
import { getAllBannersForAdmin } from "@/lib/banner-actions";
import { BannerManager } from "./BannerManager";

export default async function AdminBannersPage() {
  const bar = await requireAdmin();
  const banners = await getAllBannersForAdmin(bar.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Promo &amp; Event</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Carousel banners shown on the home page. If an active date range is
          set, a banner only appears within that period — otherwise it stays
          visible while its status is active.
        </p>
      </div>

      <BannerManager barId={bar.id} initialBanners={banners} />
    </div>
  );
}
