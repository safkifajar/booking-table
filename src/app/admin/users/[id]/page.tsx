import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Mail,
  MapPin,
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
import type { SessionVisibility } from "@/types/db";

interface PageProps {
  params: Promise<{ id: string }>;
}

function visibilityLabel(v: SessionVisibility): string {
  if (v === "public") return "Publik";
  if (v === "friends") return "Teman";
  return "Undangan";
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function AdminCustomerDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [profile, history, reviews, userRow] = await Promise.all([
    getPublicProfile(id),
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
              <h1 className="text-xl font-bold tracking-tight">
                {profile.display_name}
              </h1>
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

        {/* 2. Review dari user lain */}
        <section>
          <h2 className="text-sm font-semibold mb-2">
            Review dari pengunjung lain{" "}
            <span className="text-muted-foreground font-normal">
              ({reviews.length})
            </span>
          </h2>
          {reviews.length === 0 ? (
            <Card className="p-6 text-center border-dashed">
              <p className="text-sm text-muted-foreground">
                Belum ada review untuk customer ini.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {reviews.map((rv) => (
                <Card key={rv.id} className="p-3">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8 shrink-0">
                      {rv.rater_avatar && <AvatarImage src={rv.rater_avatar} />}
                      <AvatarFallback className="text-[10px]">
                        {initials(rv.rater_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {rv.rater_name}
                        </span>
                        <span className="flex items-center gap-0.5 text-xs text-primary shrink-0">
                          <Star className="h-3 w-3 fill-primary" />
                          {rv.stars}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {fmtDateTime(rv.created_at)}
                      </span>
                    </div>
                  </div>
                  {rv.tags.length > 0 && (
                    <HobbyBadges hobbies={rv.tags} max={10} className="mt-2" />
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* 3. Riwayat open table — klik → detail transaksi (siapa + pesan + waktu) */}
        <section>
          <h2 className="text-sm font-semibold mb-2">
            Riwayat Open Table{" "}
            <span className="text-muted-foreground font-normal">
              ({history.length})
            </span>
          </h2>
          {history.length === 0 ? (
            <Card className="p-6 text-center border-dashed">
              <p className="text-sm text-muted-foreground">
                Belum ada riwayat open table.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <Link
                  key={h.session_id}
                  href={`/admin/transactions/${h.session_id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3 transition hover:bg-muted/40 group"
                >
                  <div className="h-9 w-9 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      Meja {h.table_label}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {h.area_name}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDateTime(h.started_at)} · {visibilityLabel(h.visibility)}
                      {h.is_host && " · host"}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {h.status === "closed"
                      ? "Selesai"
                      : h.status === "cancelled"
                        ? "Dibatalkan"
                        : "Belum lunas"}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
                </Link>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            Ketuk satu riwayat untuk lihat detail: siapa di meja & pesanan apa.
          </p>
        </section>
      </div>
    </main>
  );
}
