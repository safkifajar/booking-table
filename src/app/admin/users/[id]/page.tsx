import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Phone,
  Star,
  Calendar,
} from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import {
  getPublicProfile,
  getUserTableHistory,
  getReviewsForUser,
} from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { HobbyBadges } from "@/components/network/HobbyBadges";
import { initials } from "@/lib/utils";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { eq } from "drizzle-orm";
import { CustomerReviews, CustomerHistory } from "./CustomerDetailSections";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminCustomerDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [profile, history, reviews, userRow] = await Promise.all([
    getPublicProfile(id, { allowGuest: true }),
    getUserTableHistory(id, 50),
    getReviewsForUser(id, 50),
    db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .then((r) => r[0]),
  ]);
  if (!profile) notFound();

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/users">
            <ArrowLeft className="h-4 w-4" /> Manage Customer
          </Link>
        </Button>

        {/* 1. Info customer */}
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16">
              {profile.avatar_url && <AvatarImage src={profile.avatar_url} />}
              <AvatarFallback className="text-xl">
                {initials(profile.display_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight">
                  {profile.display_name}
                </h1>
                <Badge
                  variant="secondary"
                  className={
                    profile.is_active
                      ? "text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : "text-[10px] bg-red-500/15 text-red-400 border-red-500/30"
                  }
                >
                  {profile.is_active ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>
              <div className="flex items-center gap-1 text-sm text-primary mt-0.5">
                {profile.rating.rating_count > 0 ? (
                  <>
                    <Star className="h-3.5 w-3.5 fill-primary" />
                    <span className="font-medium">{profile.rating.avg_stars}</span>
                    <span className="text-muted-foreground">
                      ({profile.rating.rating_count} ulasan)
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Belum ada rating
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 mt-2 text-sm text-muted-foreground">
                {userRow?.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> {userRow.email}
                  </span>
                )}
                {profile.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> {profile.phone}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {profile.visit_count}× nongkrong di SOHO
                </span>
              </div>
            </div>
          </div>

          {profile.bio && (
            <p className="text-sm whitespace-pre-line mt-4 pt-4 border-t border-border">
              {profile.bio}
            </p>
          )}
          {profile.hobbies.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-1.5">
                Hobi & minat
              </div>
              <HobbyBadges hobbies={profile.hobbies} max={20} />
            </div>
          )}
        </Card>

        {/* 2. Review dari user lain (paginated) */}
        <section>
          <h2 className="text-sm font-semibold mb-2">
            Review dari pengunjung lain{" "}
            <span className="text-muted-foreground font-normal">
              ({reviews.length})
            </span>
          </h2>
          <CustomerReviews reviews={reviews} />
        </section>

        {/* 3. Riwayat open table (paginated) — klik → detail transaksi */}
        <section>
          <h2 className="text-sm font-semibold mb-2">
            Riwayat Open Table{" "}
            <span className="text-muted-foreground font-normal">
              ({history.length})
            </span>
          </h2>
          <CustomerHistory history={history} />
          <p className="text-[11px] text-muted-foreground mt-2">
            Ketuk satu riwayat untuk lihat detail: siapa di meja & pesanan apa.
          </p>
        </section>
      </div>
    </main>
  );
}
