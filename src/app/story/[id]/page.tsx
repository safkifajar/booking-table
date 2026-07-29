import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getStoryOwner } from "@/lib/story-actions";
import { StorySoloViewer } from "@/components/story/StorySoloViewer";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Halaman detail satu story — dibuka dari notifikasi mention/repost.
 * Membuka StoryViewer untuk pembuat story tsb. Kalau story sudah hilang
 * (expired/dihapus), arahkan ke beranda.
 */
export default async function StoryPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/auth?next=${encodeURIComponent(`/story/${id}`)}`);
  }

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const owner = isUuid ? await getStoryOwner(id) : null;
  if (!owner) redirect("/"); // story hilang → beranda

  return (
    <StorySoloViewer
      barId={owner.barId}
      ownerId={owner.userId}
      viewerId={profile.id}
      ownerName={owner.displayName}
      ownerAvatarUrl={owner.avatarUrl}
    />
  );
}
