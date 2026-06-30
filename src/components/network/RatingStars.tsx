import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRatingSummary } from "@/types/db";

/**
 * Rating ringkas: bintang + rata-rata + jumlah ulasan. Dipakai di kartu
 * network & detail profil. Kalau belum ada rating → "Belum ada rating".
 */
export function RatingStars({
  rating,
  className,
}: {
  rating: UserRatingSummary;
  className?: string;
}) {
  if (!rating || rating.rating_count === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        No rating yet
      </span>
    );
  }
  return (
    <span
      className={cn("flex items-center gap-0.5 text-xs text-primary", className)}
    >
      <Star className="h-3.5 w-3.5 fill-primary" />
      <span className="font-medium">{rating.avg_stars}</span>
      <span className="text-muted-foreground">({rating.rating_count})</span>
    </span>
  );
}
