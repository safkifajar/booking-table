"use client";

import { useRouter } from "next/navigation";
import { StoryViewer } from "./StoryViewer";

/**
 * Membuka StoryViewer untuk SATU user (dipakai halaman /story/[id] saat user
 * klik notifikasi mention/repost). Tutup → kembali ke beranda.
 */
export function StorySoloViewer({
  barId,
  ownerId,
  viewerId,
  ownerName,
  ownerAvatarUrl,
}: {
  barId: string;
  ownerId: string;
  viewerId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
}) {
  const router = useRouter();
  return (
    <StoryViewer
      barId={barId}
      startUserId={ownerId}
      viewerId={viewerId}
      orderedUserIds={[ownerId]}
      userMeta={{
        [ownerId]: { displayName: ownerName, avatarUrl: ownerAvatarUrl },
      }}
      onClose={() => router.push("/")}
    />
  );
}
