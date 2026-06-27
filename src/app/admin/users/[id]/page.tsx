import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Star, Calendar, MessageSquare, History } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import {
  getPublicProfile,
  getUserTableHistory,
  getReviewsForUser,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { StatCard } from "@/app/admin/components/StatCard";
import { initials } from "@/lib/utils";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { eq } from "drizzle-orm";
import { CustomerDetailTabs } from "./CustomerDetailTabs";

interface PageProps {
  params: Promise<{ id: string }>;
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

  const email = userRow?.email ?? "";

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/users">
            <ArrowLeft className="h-4 w-4" /> Manage Customer
          </Link>
        </Button>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Calendar className="h-4 w-4" />}
            label="Kunjungan"
            value={profile.visit_count.toLocaleString("id-ID")}
          />
          <StatCard
            icon={<Star className="h-4 w-4" />}
            label="Rating"
            value={
              profile.rating.rating_count > 0
                ? String(profile.rating.avg_stars)
                : "—"
            }
            sub={
              profile.rating.rating_count > 0
                ? `${profile.rating.rating_count} ulasan`
                : "belum ada"
            }
          />
          <StatCard
            icon={<MessageSquare className="h-4 w-4" />}
            label="Review"
            value={reviews.length.toLocaleString("id-ID")}
          />
          <StatCard
            icon={<History className="h-4 w-4" />}
            label="Riwayat"
            value={history.length.toLocaleString("id-ID")}
          />
        </div>

        {/* Header customer */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              {profile.avatar_url && <AvatarImage src={profile.avatar_url} />}
              <AvatarFallback className="text-lg">
                {initials(profile.display_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold tracking-tight truncate">
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
              <p className="text-sm text-muted-foreground truncate">{email}</p>
            </div>
          </div>
        </div>

        {/* Tabs: Detail / Review / Riwayat / Ubah Password */}
        <CustomerDetailTabs
          customer={{
            id: profile.id,
            name: profile.display_name,
            email,
            phone: profile.phone,
            birthDate: profile.birth_date,
            gender: (profile.gender as "" | "male" | "female") ?? "",
            interestedIn:
              (profile.interested_in as "" | "male" | "female" | "both") ?? "",
            isActive: profile.is_active,
            bio: profile.bio,
            hobbies: profile.hobbies,
          }}
          reviews={reviews}
          history={history}
        />
      </div>
    </main>
  );
}
