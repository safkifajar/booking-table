import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";

interface Props {
  title: string;
  /** Eyebrow text di atas title (opsional, kapital tipis) */
  eyebrow?: string;
}

/**
 * Shared header untuk semua sub-pages di /profile/*.
 * - Tombol back → /profile (list menu)
 * - Title + eyebrow konsisten
 * - UserMenu di kanan
 */
export function ProfileSubpageHeader({ title, eyebrow }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/profile" aria-label="Kembali ke Profile">
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
        <UserMenu />
      </div>
    </header>
  );
}
