import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getActiveStoriesByBar } from "@/lib/story-actions";
import { StoryBar } from "./StoryBar";

interface Props {
  /** Slug bar — kalau tidak ada, pakai NEXT_PUBLIC_BAR_SLUG */
  barSlug?: string;
}

/**
 * Server Component wrapper untuk StoryBar.
 *
 * - Resolve barId dari slug
 * - Cek user login (kalau tidak, render null — story butuh auth)
 * - Fetch active stories grouped by user via getActiveStoriesByBar
 * - Pass ke StoryBar client component
 *
 * Render-nya tipis: cuma section + padding. Caller embed di mana saja
 * tanpa khawatir layout double-up.
 */
export async function StoryBarSection({ barSlug }: Props) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const slug = barSlug ?? process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const [bar] = await db
    .select({ id: bars.id })
    .from(bars)
    .where(eq(bars.slug, slug));
  if (!bar) return null;

  const items = await getActiveStoriesByBar(bar.id, profile.id);

  // Selalu render StoryBar — meskipun list kosong, user kita kasih akses
  // "Your Story" bubble supaya bisa upload pertama.

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-4 border-b border-border">
      <StoryBar
        barId={bar.id}
        viewerId={profile.id}
        viewerDisplayName={profile.displayName}
        viewerAvatarUrl={profile.avatarUrl}
        initialItems={items}
      />
    </section>
  );
}
