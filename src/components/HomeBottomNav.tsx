"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { StoryUploader } from "@/components/story/StoryUploader";
import { StoryTextComposer } from "@/components/story/StoryTextComposer";
import { StoryTypePicker } from "@/components/story/StoryBar";

interface Props {
  barId: string;
  isAnon: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
}

/**
 * Client wrapper: BottomNav + composer story.
 *
 * Center camera button di BottomNav → sheet pilih Photo/Text (sheet yang SAMA
 * dengan story bar), lalu buka composer sesuai pilihan. Setelah sukses,
 * refresh server data supaya story baru langsung tampil di feed.
 */
export function HomeBottomNav({
  barId,
  isAnon,
  avatarUrl,
  displayName,
}: Props) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [textOpen, setTextOpen] = React.useState(false);

  return (
    <>
      <BottomNav
        barId={barId}
        isAnon={isAnon}
        avatarUrl={avatarUrl}
        displayName={displayName}
        onUploadStory={() => setPickerOpen(true)}
      />

      {/* Sheet pilih jenis story */}
      {pickerOpen && (
        <StoryTypePicker
          onClose={() => setPickerOpen(false)}
          onPhoto={() => {
            setPickerOpen(false);
            setUploadOpen(true);
          }}
          onText={() => {
            setPickerOpen(false);
            setTextOpen(true);
          }}
        />
      )}

      {/* Composer foto */}
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

      {/* Composer teks */}
      {textOpen && (
        <StoryTextComposer
          barId={barId}
          onClose={() => setTextOpen(false)}
          onCreated={() => {
            setTextOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
