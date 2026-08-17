import type { Metadata } from "next";
import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { getLinkTree } from "@/lib/link-tree-actions";
import { LinkIcon } from "@/components/LinkIcon";

/**
 * Halaman link-tree PUBLIK — diakses lewat link.<domain>, dipasang di bio
 * Instagram. Tanpa login, tanpa bottom nav: satu layar, langsung tautan.
 *
 * Dinamis supaya perubahan dari admin langsung terlihat (tautan promo sering
 * berubah; halaman ter-cache akan menyesatkan pengunjung).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const data = await getLinkTree();
  const name = data?.barName ?? "SOHO Social House";
  const title = data?.config.headline?.trim() || name;
  return {
    title,
    description:
      data?.config.tagline?.trim() ||
      `Links, contact, and reservations for ${name}.`,
    // Halaman ini memang untuk dibagikan — biarkan terindeks.
    robots: { index: true, follow: true },
  };
}

export default async function LinkTreePage() {
  const data = await getLinkTree();

  if (!data) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      </main>
    );
  }

  const { barName, logoUrl, config, links } = data;
  const headline = config.headline?.trim() || barName;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-primary/[0.07] via-background to-background">
      <div className="mx-auto w-full max-w-md px-5 py-10 sm:py-14">
        {/* Identitas */}
        <div className="flex flex-col items-center text-center">
          {logoUrl ? (
            <span className="relative h-20 w-20 overflow-hidden rounded-2xl border border-border shadow-lg">
              <Image
                src={logoUrl}
                alt={barName}
                fill
                sizes="80px"
                className="object-cover"
              />
            </span>
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-2xl font-bold text-primary">
              {barName.slice(0, 2).toUpperCase()}
            </span>
          )}
          <h1 className="mt-4 text-xl font-bold">{headline}</h1>
          {config.tagline?.trim() && (
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
              {config.tagline}
            </p>
          )}
        </div>

        {/* Daftar tautan */}
        <div className="mt-8 space-y-3">
          {links.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No links yet.
            </p>
          ) : (
            links.map((l) => (
              <a
                key={l.id}
                href={l.url}
                // Tautan keluar: buka tab baru + rel keamanan (cegah tab
                // tujuan mengakses window kita).
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition hover:border-primary/50 hover:bg-muted/50 active:scale-[0.99]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                  <LinkIcon name={l.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold group-hover:text-primary transition">
                    {l.label}
                  </span>
                  {l.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {l.description}
                    </span>
                  )}
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary transition" />
              </a>
            ))
          )}
        </div>

        <p className="mt-10 text-center text-[10px] text-muted-foreground/50">
          {barName}
        </p>
      </div>
    </main>
  );
}
