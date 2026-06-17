"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { StoryUploader } from "@/components/story/StoryUploader";

interface Props {
  barId: string;
  isAnon: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
}

/**
 * Client wrapper: BottomNav + StoryUploader modal state.
 *
 * Center camera button di BottomNav fire callback → buka uploader modal.
 * Setelah upload sukses, refresh server data supaya story baru langsung
 * tampil di feed.
 */
export function HomeBottomNav({
  barId,
  isAnon,
  avatarUrl,
  displayName,
}: Props) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = React.useState(false);

  return (
    <>
      <BottomNav
        barId={barId}
        isAnon={isAnon}
        avatarUrl={avatarUrl}
        displayName={displayName}
        onUploadStory={() => setUploadOpen(true)}
      />

      {uploadOpen && (
        <StoryUploader
          barId={barId}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
