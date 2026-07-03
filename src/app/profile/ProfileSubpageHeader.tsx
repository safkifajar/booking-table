import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface Props {
  title: string;
  /** Eyebrow text di atas title (opsional, kapital tipis) */
  eyebrow?: string;
  /** Tujuan tombol back (default /profile). */
  backHref?: string;
}

/**
 * Shared header untuk semua sub-pages di /profile/*.
 * - Tombol back → backHref (default /profile)
 * - Title + eyebrow konsisten
 */
export function ProfileSubpageHeader({
  title,
  eyebrow,
  backHref = "/profile",
}: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={backHref} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-widest text-primary/70">
              {eyebrow}
            </div>
          )}
          <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>
        </div>
      </div>
    </header>
  );
}
