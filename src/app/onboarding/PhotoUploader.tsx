"use client";

import * as React from "react";
import { toast } from "sonner";
import { Camera, X, Loader2 } from "lucide-react";
import { uploadProfilePhoto, removeProfilePhoto } from "@/lib/actions";
import { getActionErrorMessage, cn } from "@/lib/utils";

const MAX_BYTES = 4 * 1024 * 1024; // 4MB — batas server
const MAX_SIDE = 1280; // sisi terpanjang setelah resize

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.type === "" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

// Kompres di client: resize sisi terpanjang ≤ MAX_SIDE (jaga rasio, tak upscale),
// lalu encode webp q0.8. Return null kalau gagal (caller fallback ke file asli).
async function compressToWebp(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1; // jangan upscale
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/webp", 0.8);
    });
    return blob;
  } catch {
    return null;
  }
}

export function PhotoUploader({
  photos,
  onChange,
  max = 3,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  max?: number;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Slot mana yang sedang loading (index slot yang diklik untuk upload).
  const [uploadingSlot, setUploadingSlot] = React.useState<number | null>(null);
  // Index foto yang sedang dihapus.
  const [removingIndex, setRemovingIndex] = React.useState<number | null>(null);

  const busy = uploadingSlot !== null || removingIndex !== null;

  function openPicker() {
    if (busy) return;
    inputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset value supaya file yang sama bisa dipilih ulang nanti.
    e.target.value = "";
    if (!file) return;

    const slot = photos.length; // upload mengisi slot kosong berikutnya
    setUploadingSlot(slot);
    try {
      let payload: Blob = file;

      if (isHeic(file)) {
        // Canvas tak bisa decode HEIC — kirim asli, server yang handle.
        if (file.size > MAX_BYTES) {
          toast.error("Photo too large (max 4MB)");
          return;
        }
      } else {
        const compressed = await compressToWebp(file);
        if (compressed) {
          payload = compressed;
        } else if (file.size > MAX_BYTES) {
          // Gagal kompres & file asli terlalu besar.
          toast.error("Photo too large (max 4MB)");
          return;
        }
      }

      // Jaga-jaga: hasil kompres pun masih di atas batas.
      if (payload.size > MAX_BYTES) {
        toast.error("Photo too large (max 4MB)");
        return;
      }

      const fd = new FormData();
      fd.append("file", payload, "photo.webp");
      const res = await uploadProfilePhoto(fd);
      onChange(res.photos);
      toast.success("Photo added");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Upload failed"));
    } finally {
      setUploadingSlot(null);
    }
  }

  async function handleRemove(index: number) {
    if (busy) return;
    setRemovingIndex(index);
    try {
      const res = await removeProfilePhoto(index);
      onChange(res.photos);
      toast.success("Photo removed");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to remove"));
    } finally {
      setRemovingIndex(null);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={handleFileChange}
      />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: max }).map((_, slot) => {
          const url = photos[slot];
          const isUploading = uploadingSlot === slot;
          const isRemoving = removingIndex === slot;

          if (url) {
            return (
              <div
                key={slot}
                className="relative aspect-square rounded-xl overflow-hidden border border-border bg-muted/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Photo ${slot + 1}`}
                  className="h-full w-full object-cover"
                />
                {slot === 0 && (
                  <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    Main
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => handleRemove(slot)}
                  disabled={busy}
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 disabled:opacity-50"
                >
                  {isRemoving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          }

          return (
            <button
              key={slot}
              type="button"
              onClick={openPicker}
              disabled={busy}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground transition hover:text-foreground hover:border-muted-foreground/60 disabled:opacity-50",
                isUploading && "pointer-events-none"
              )}
            >
              {isUploading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Camera className="h-6 w-6" />
                  <span className="text-xs font-medium">Add</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
