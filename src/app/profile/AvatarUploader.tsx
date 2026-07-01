"use client";

import * as React from "react";
import { toast } from "sonner";
import { Camera, Trash2, Loader2 } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { uploadAvatar, deleteAvatar } from "@/lib/actions";
import { useConfirm } from "@/components/ConfirmDialog";
import { initials, getActionErrorMessage } from "@/lib/utils";

interface Props {
  initialAvatarUrl: string | null;
  displayName: string;
}

const MAX_MB = 10;
// HEIC: beberapa browser tidak set MIME, fallback via extension di accept attr.
// Server validate ulang (lihat isHeicFile di lib/actions.ts).
const ACCEPTED =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function AvatarUploader({ initialAvatarUrl, displayName }: Props) {
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(initialAvatarUrl);
  const [uploading, setUploading] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side pre-check (server tetap validate ulang)
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`File too large (max ${MAX_MB}MB)`);
      e.target.value = "";
      return;
    }
    // Cek MIME, fallback ke extension untuk HEIC (sering MIME kosong)
    const name = file.name.toLowerCase();
    const isHeic = name.endsWith(".heic") || name.endsWith(".heif");
    if (!ACCEPTED_MIME.has(file.type) && !isHeic) {
      toast.error("Format must be JPG, PNG, WebP, or HEIC");
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadAvatar(formData);
      setAvatarUrl(result.avatarUrl);
      toast.success("Profile photo saved");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to upload photo"));
    } finally {
      setUploading(false);
      // Reset input value supaya bisa pilih file yang sama lagi kalau gagal
      e.target.value = "";
    }
  }

  async function handleDelete() {
    if (!avatarUrl) return;

    const ok = await confirm({
      title: "Delete profile photo?",
      description:
        "Your photo will be removed and you'll return to the default avatar (your name initials). You can upload a new photo anytime.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    setDeleting(true);
    try {
      await deleteAvatar();
      setAvatarUrl(null);
      toast.success("Profile photo deleted");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to delete photo"));
    } finally {
      setDeleting(false);
    }
  }

  const busy = uploading || deleting;

  return (
    <div className="flex items-center gap-4">
      {/* Avatar preview */}
      <div className="relative">
        <Avatar className="h-20 w-20 ring-2 ring-border">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
          <AvatarFallback className="text-xl">
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        {uploading && (
          <div className="absolute inset-0 bg-background/80 rounded-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex-1 space-y-2 min-w-0">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Camera className="h-4 w-4" />
            {avatarUrl ? "Change photo" : "Upload photo"}
          </Button>
          {avatarUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={busy}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          JPG, PNG, WebP, or HEIC (iPhone). Max {MAX_MB}MB. Automatically resized to 256×256.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
