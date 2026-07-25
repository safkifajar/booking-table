import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar } from "lucide-react";
import { getPublicBannerById } from "@/lib/banner-actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Halaman detail promo — dibuka saat customer mengklik banner di beranda.
 * Menampilkan gambar besar + judul + subtitle + isi detail (content).
 * Banner tanpa content tetap bisa dibuka (hanya gambar + judul + subtitle).
 */
export default async function PromoDetailPage({ params }: PageProps) {
  const { id } = await params;
  // Guard: UUID tak valid → 404 (jangan lempar error DB).
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) notFound();

  const banner = await getPublicBannerById(id);
  if (!banner) notFound();

  const isEvent = banner.category === "event";
  const kindLabel = isEvent ? "Event" : "Promo";
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  const periodLabel = banner.startsAt
    ? banner.endsAt
      ? `${fmtDate(banner.startsAt)} – ${fmtDate(banner.endsAt)}`
      : `from ${fmtDate(banner.startsAt)}`
    : banner.endsAt
      ? `until ${fmtDate(banner.endsAt)}`
      : null;

  return (
    <main className="flex-1 pb-16">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-base font-semibold truncate">{kindLabel}</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Gambar */}
        <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden bg-zinc-900 border border-border">
          <Image
            src={banner.imageUrl}
            alt={banner.title ?? "Promo"}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 672px"
            priority
          />
        </div>

        {/* Judul + kategori + subtitle + tanggal */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span
              className={
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide " +
                (isEvent
                  ? "bg-sky-500/15 border border-sky-500/40 text-sky-400"
                  : "bg-primary/15 border border-primary/40 text-primary")
              }
            >
              {kindLabel}
            </span>
            {periodLabel && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <Calendar className="h-3.5 w-3.5" />
                {periodLabel}
              </span>
            )}
          </div>
          {banner.title && (
            <h2 className="text-xl font-bold tracking-tight">{banner.title}</h2>
          )}
          {banner.subtitle && (
            <p className="text-sm text-muted-foreground mt-1">
              {banner.subtitle}
            </p>
          )}
        </div>

        {/* Isi detail — line break dipertahankan (whitespace-pre-line). */}
        {banner.content ? (
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {banner.content}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No further details for this promo.
          </p>
        )}
      </div>
    </main>
  );
}
