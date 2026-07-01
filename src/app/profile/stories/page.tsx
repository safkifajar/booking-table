import { redirect } from "next/navigation";
import Image from "next/image";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { stories } from "@/lib/db/schema/stories";
import { tableSessions } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { Camera, MapPin, Clock } from "lucide-react";
import { RelativeTime } from "@/components/ui/relative-time";
import { ProfileSubpageHeader } from "../ProfileSubpageHeader";

/**
 * Halaman riwayat story user sendiri.
 *
 * Sekarang cuma show story yang masih aktif (belum expire 24 jam).
 * Future: bisa diperluas jadi arsip permanent dengan opt-in save.
 */
export default async function ProfileStoriesPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/stories");
  }

  const now = new Date();

  const rows = await db
    .select({
      id: stories.id,
      imageUrl: stories.imageUrl,
      caption: stories.caption,
      createdAt: stories.createdAt,
      expiresAt: stories.expiresAt,
      table_label: tables.label,
      area_name: floorAreas.name,
    })
    .from(stories)
    .leftJoin(tableSessions, eq(tableSessions.id, stories.tableSessionId))
    .leftJoin(tables, eq(tables.id, tableSessions.tableId))
    .leftJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .where(and(eq(stories.userId, profile.id), gte(stories.expiresAt, now)))
    .orderBy(desc(stories.createdAt));

  return (
    <main className="flex-1 pb-12">
      <ProfileSubpageHeader title="My Story" eyebrow="Profile" />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div>
            <p className="text-xs text-muted-foreground mb-4">
              {rows.length} active stories · Expires 24 hours after upload
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {rows.map((s) => (
                <StoryCard key={s.id} story={s} />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StoryCard({
  story,
}: {
  story: {
    id: string;
    imageUrl: string;
    caption: string | null;
    createdAt: Date;
    expiresAt: Date;
    table_label: string | null;
    area_name: string | null;
  };
}) {
  const expireMinutes = Math.max(
    0,
    Math.floor((story.expiresAt.getTime() - Date.now()) / 60_000)
  );
  const expireLabel =
    expireMinutes < 60 ? `${expireMinutes}m` : `${Math.floor(expireMinutes / 60)}h`;

  return (
    <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-zinc-900 group">
      <Image
        src={story.imageUrl}
        alt={story.caption ?? "Story"}
        fill
        className="object-cover"
        sizes="(max-width: 640px) 50vw, 33vw"
      />
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent">
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-[10px] text-white/80 flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {expireLabel}
        </div>
        <div className="absolute bottom-0 inset-x-0 p-2 space-y-1">
          {story.table_label && (
            <div className="flex items-center gap-1 text-[10px] text-white/80">
              <MapPin className="h-2.5 w-2.5" />
              {story.table_label}
            </div>
          )}
          {story.caption && (
            <p className="text-xs text-white line-clamp-2">{story.caption}</p>
          )}
          <div className="text-[10px] text-white/50">
            <RelativeTime
              date={story.createdAt.toISOString()}
              className="text-[10px] text-white/50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <Camera className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
      <h2 className="text-sm font-medium mb-1">No story yet</h2>
      <p className="text-xs text-muted-foreground">
        Upload a story from the home page — tap the &quot;Your story&quot; bubble
        in the story bar to get started.
      </p>
    </div>
  );
}
