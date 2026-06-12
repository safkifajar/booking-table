"use client";

import * as React from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Edit2,
  Calendar,
  Image as ImageIcon,
  Loader2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  createBanner,
  updateBanner,
  replaceBannerImage,
  deleteBanner,
  type AdminBanner,
} from "@/lib/banner-actions";
import { getActionErrorMessage, cn } from "@/lib/utils";

interface Props {
  barId: string;
  initialBanners: AdminBanner[];
}

const ACCEPTED =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export function BannerManager({ barId, initialBanners }: Props) {
  const [banners, setBanners] = React.useState(initialBanners);
  const [editing, setEditing] = React.useState<AdminBanner | null>(null);
  const [creating, setCreating] = React.useState(false);
  const confirm = useConfirm();

  async function handleDelete(banner: AdminBanner) {
    const ok = await confirm({
      title: "Hapus banner ini?",
      description: `Banner "${banner.title ?? "(tanpa judul)"}" akan dihapus permanent dari list dan tidak tampil lagi di landing.`,
      confirmText: "Hapus",
      cancelText: "Batal",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await deleteBanner(banner.id);
      setBanners((arr) => arr.filter((b) => b.id !== banner.id));
      toast.success("Banner dihapus");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus banner"));
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button variant="gold" size="lg" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Banner Baru
        </Button>
      </div>

      {banners.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">Belum ada banner</p>
          <p className="text-xs text-muted-foreground mb-4">
            Upload banner pertama supaya tampil di landing page.
          </p>
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Banner Baru
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {banners.map((b) => (
            <BannerRow
              key={b.id}
              banner={b}
              onEdit={() => setEditing(b)}
              onDelete={() => handleDelete(b)}
            />
          ))}
        </div>
      )}

      {creating && (
        <BannerFormModal
          mode="create"
          barId={barId}
          onClose={() => setCreating(false)}
          onSaved={(banner) => {
            setBanners((arr) =>
              [...arr, banner].sort((a, b) =>
                a.sortOrder !== b.sortOrder
                  ? a.sortOrder - b.sortOrder
                  : a.createdAt.getTime() - b.createdAt.getTime()
              )
            );
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <BannerFormModal
          mode="edit"
          banner={editing}
          onClose={() => setEditing(null)}
          onSaved={(banner) => {
            setBanners((arr) =>
              arr
                .map((b) => (b.id === banner.id ? banner : b))
                .sort((a, b) =>
                  a.sortOrder !== b.sortOrder
                    ? a.sortOrder - b.sortOrder
                    : a.createdAt.getTime() - b.createdAt.getTime()
                )
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function BannerRow({
  banner,
  onEdit,
  onDelete,
}: {
  banner: AdminBanner;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const now = Date.now();
  const inWindow =
    (!banner.startsAt || banner.startsAt.getTime() <= now) &&
    (!banner.endsAt || banner.endsAt.getTime() >= now);
  const showing = banner.isActive && inWindow;

  return (
    <Card className="overflow-hidden flex flex-col sm:flex-row">
      <div className="relative w-full sm:w-48 aspect-[16/9] sm:aspect-[16/9] shrink-0 bg-zinc-900">
        <Image
          src={banner.imageUrl}
          alt={banner.title ?? "Banner"}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, 192px"
        />
      </div>

      <div className="flex-1 p-4 min-w-0 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={showing ? "default" : "secondary"} className="text-[10px]">
              {showing ? "Tampil" : !banner.isActive ? "Mati" : "Belum/Sudah"}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              Urutan #{banner.sortOrder}
            </span>
          </div>
          <div className="font-medium truncate">
            {banner.title ?? "(tanpa judul)"}
          </div>
          {banner.subtitle && (
            <div className="text-xs text-muted-foreground line-clamp-2">
              {banner.subtitle}
            </div>
          )}
          {(banner.startsAt || banner.endsAt) && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {banner.startsAt
                ? banner.startsAt.toISOString().slice(0, 10)
                : "..."}
              {" → "}
              {banner.endsAt ? banner.endsAt.toISOString().slice(0, 10) : "..."}
            </div>
          )}
        </div>

        <div className="flex sm:flex-col gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit2 className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Hapus
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ============================================================
// FORM MODAL (create + edit)
// ============================================================

interface FormProps {
  mode: "create" | "edit";
  barId?: string;
  banner?: AdminBanner;
  onClose: () => void;
  onSaved: (banner: AdminBanner) => void;
}

function BannerFormModal({ mode, barId, banner, onClose, onSaved }: FormProps) {
  const isEdit = mode === "edit";
  const effectiveBarId = isEdit ? undefined : barId;

  const [title, setTitle] = React.useState(banner?.title ?? "");
  const [subtitle, setSubtitle] = React.useState(banner?.subtitle ?? "");
  const [sortOrder, setSortOrder] = React.useState(banner?.sortOrder ?? 0);
  const [isActive, setIsActive] = React.useState(banner?.isActive ?? true);
  const [startsAt, setStartsAt] = React.useState(
    banner?.startsAt?.toISOString().slice(0, 10) ?? ""
  );
  const [endsAt, setEndsAt] = React.useState(
    banner?.endsAt?.toISOString().slice(0, 10) ?? ""
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(
    banner?.imageUrl ?? null
  );
  const [saving, setSaving] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:"))
        URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File terlalu besar (max 10MB)");
      return;
    }
    setFile(f);
    if (previewUrl && previewUrl.startsWith("blob:"))
      URL.revokeObjectURL(previewUrl);
    if (
      f.name.toLowerCase().endsWith(".heic") ||
      f.name.toLowerCase().endsWith(".heif")
    ) {
      // HEIC tidak preview di browser
      setPreviewUrl(null);
    } else {
      setPreviewUrl(URL.createObjectURL(f));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEdit && !file) {
      toast.error("Pilih foto banner dulu");
      return;
    }

    setSaving(true);
    try {
      if (isEdit && banner) {
        // Edit flow: update meta dulu, lalu replace image kalau ada file baru
        await updateBanner({
          id: banner.id,
          title,
          subtitle,
          sortOrder,
          isActive,
          startsAt,
          endsAt,
        });
        if (file) {
          const fd = new FormData();
          fd.append("id", banner.id);
          fd.append("file", file);
          await replaceBannerImage(fd);
        }
        toast.success("Banner ter-update");

        // Build updated banner shape buat callback
        onSaved({
          ...banner,
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          sortOrder,
          isActive,
          startsAt: startsAt ? new Date(startsAt) : null,
          endsAt: endsAt ? new Date(endsAt) : null,
          imageUrl: file
            ? `${banner.imageUrl.split("?")[0]}?v=${Date.now()}`
            : banner.imageUrl,
        });
      } else {
        // Create flow
        if (!effectiveBarId || !file) return;
        const fd = new FormData();
        fd.append("barId", effectiveBarId);
        fd.append("file", file);
        if (title.trim()) fd.append("title", title.trim());
        if (subtitle.trim()) fd.append("subtitle", subtitle.trim());
        fd.append("sortOrder", String(sortOrder));
        fd.append("isActive", String(isActive));
        if (startsAt) fd.append("startsAt", startsAt);
        if (endsAt) fd.append("endsAt", endsAt);

        const { id } = await createBanner(fd);
        toast.success("Banner ter-upload");

        onSaved({
          id,
          imageUrl: previewUrl ?? "",
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          sortOrder,
          isActive,
          startsAt: startsAt ? new Date(startsAt) : null,
          endsAt: endsAt ? new Date(endsAt) : null,
          createdAt: new Date(),
        });
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-lg my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">
            {isEdit ? "Edit banner" : "Banner baru"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60 transition"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Image preview + picker */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Foto banner * (16:9, max 10MB)
            </label>
            {previewUrl ? (
              <div className="relative aspect-[16/9] rounded-md overflow-hidden bg-zinc-900">
                <Image
                  src={previewUrl}
                  alt="Preview"
                  fill
                  className="object-cover"
                  unoptimized={previewUrl.startsWith("blob:")}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 transition flex items-center justify-center text-white text-sm font-medium"
                >
                  Ganti foto
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-[16/9] border-2 border-dashed border-border rounded-md flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
              >
                <ImageIcon className="h-8 w-8" />
                <span className="text-sm">Pilih foto</span>
                <span className="text-xs text-muted-foreground/70">
                  JPG, PNG, WebP, HEIC
                </span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Judul (opsional, max 80)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              maxLength={80}
              placeholder="cth: Happy Hour Setiap Jumat"
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Subtitle */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Deskripsi (opsional, max 200)
            </label>
            <textarea
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value.slice(0, 200))}
              maxLength={200}
              rows={2}
              placeholder="cth: Beli 1 gratis 1 mocktail, jam 17-19"
              className="w-full px-3 py-2 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition resize-none text-sm"
            />
          </div>

          {/* Sort + active */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Urutan (kecil = atas)
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                min={0}
                max={999}
                className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Status
              </label>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={cn(
                  "w-full h-11 px-3 rounded-md border text-sm font-medium transition",
                  isActive
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-muted/40 border-border text-muted-foreground"
                )}
              >
                {isActive ? "Aktif" : "Mati"}
              </button>
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Mulai (opsional)
              </label>
              <input
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Sampai (opsional)
              </label>
              <input
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Batal
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : isEdit ? (
                "Simpan perubahan"
              ) : (
                "Buat banner"
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
