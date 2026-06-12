"use client";

import * as React from "react";
import Image from "next/image";
import { toast } from "sonner";
import { X, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createStory } from "@/lib/story-actions";
import { getActionErrorMessage, cn } from "@/lib/utils";

interface Props {
  barId: string;
  onClose: () => void;
  onUploaded: () => void;
}

const MAX_MB = 10;
const ACCEPTED =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const MAX_CAPTION = 280;

/**
 * Full-screen modal untuk upload story baru.
 *
 * Flow:
 * 1. Buka modal → langsung trigger file picker
 * 2. Setelah pilih file → preview foto + input caption
 * 3. Tombol "Post" → upload via Server Action → close modal
 */
export function StoryUploader({ barId, onClose, onUploaded }: Props) {
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [caption, setCaption] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const autoOpenedRef = React.useRef(false);

  // Auto-trigger file picker on first mount only.
  // Pakai ref flag karena React Strict Mode di dev mount 2x — tanpa flag
  // file picker terbuka 2 kali, pilihan pertama ke-overwrite oleh modal kedua.
  React.useEffect(() => {
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    fileInputRef.current?.click();
  }, []);

  // Cleanup object URL
  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ESC to close
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !uploading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, uploading]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) {
      // User batal pilih file — kalau belum ada preview, close modal
      if (!file) onClose();
      return;
    }

    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`File terlalu besar (max ${MAX_MB}MB)`);
      return;
    }

    const name = f.name.toLowerCase();
    const isHeic = name.endsWith(".heic") || name.endsWith(".heif");
    if (!ACCEPTED_MIME.has(f.type) && !isHeic) {
      toast.error("Format harus JPG, PNG, WebP, atau HEIC");
      return;
    }

    // Cleanup previous preview
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setFile(f);
    // HEIC tidak bisa di-preview di browser — show placeholder
    if (isHeic) {
      setPreviewUrl(null);
    } else {
      setPreviewUrl(URL.createObjectURL(f));
    }
  }

  async function handleSubmit() {
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("barId", barId);
      if (caption.trim()) formData.append("caption", caption.trim());

      await createStory(formData);
      toast.success("Story ter-upload");
      onUploaded();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal upload story"));
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button
          type="button"
          onClick={onClose}
          disabled={uploading}
          className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-white/10 transition disabled:opacity-50"
          aria-label="Tutup"
        >
          <X className="h-5 w-5 text-white" />
        </button>
        <h1 className="text-sm font-semibold text-white">Story baru</h1>
        <div className="w-9" /> {/* spacer */}
      </header>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-4 py-6 gap-6">
        {file && previewUrl ? (
          <div className="relative max-w-md w-full aspect-[9/16] bg-zinc-900 rounded-xl overflow-hidden">
            <Image
              src={previewUrl}
              alt="Story preview"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        ) : file ? (
          // HEIC tanpa preview
          <div className="max-w-md w-full aspect-[9/16] bg-zinc-900 rounded-xl flex flex-col items-center justify-center gap-2 text-white/70">
            <Camera className="h-12 w-12 text-primary" />
            <span className="text-sm">{file.name}</span>
            <span className="text-xs text-white/40">
              (preview tidak tersedia untuk HEIC)
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="max-w-md w-full aspect-[9/16] border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-2 text-white/60 hover:border-primary/40 hover:text-white transition"
          >
            <Camera className="h-12 w-12" />
            <span className="text-sm">Pilih foto</span>
            <span className="text-xs text-white/40">JPG, PNG, WebP, HEIC</span>
          </button>
        )}

        {file && (
          <div className="w-full max-w-md space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs uppercase tracking-wider text-white/60">
                  Caption (opsional)
                </label>
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    caption.length > MAX_CAPTION - 30
                      ? "text-amber-400"
                      : "text-white/40"
                  )}
                >
                  {caption.length}/{MAX_CAPTION}
                </span>
              </div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
                placeholder="Tulis sesuatu..."
                maxLength={MAX_CAPTION}
                rows={2}
                className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/15 text-white placeholder:text-white/40 focus:outline-none focus:border-primary/60 transition text-sm resize-none"
              />
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Pilih foto lain
            </button>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {file && (
        <footer className="px-4 py-4 border-t border-white/10">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={uploading}
            variant="gold"
            size="lg"
            className="w-full max-w-md mx-auto flex"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Mengupload...
              </>
            ) : (
              "Post Story"
            )}
          </Button>
        </footer>
      )}

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
