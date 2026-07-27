import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getBarBySlug } from "@/lib/queries";
import { getActiveBanners } from "@/lib/banner-actions";
import { PromoListView } from "./PromoListView";

export const dynamic = "force-dynamic";

/**
 * Halaman daftar Promo & Event — dibuka dari tombol "See all" di beranda.
 * Menampilkan semua banner yang sedang tayang, dipisah 2 tab (Promo / Event).
 */
export default async function PromoListPage() {
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const bar = await getBarBySlug(barSlug);
  const banners = bar ? await getActiveBanners(bar.id) : [];

  return (
    <main className="flex-1 pb-16">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-base font-semibold truncate">Promos &amp; Events</h1>
        </div>
      </header>

      <PromoListView banners={banners} />
    </main>
  );
}
