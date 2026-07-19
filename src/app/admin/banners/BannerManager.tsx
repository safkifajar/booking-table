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
import { DatePicker } from "@/components/ui/date-picker";

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
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const confirm = useConfirm();

  async function handleDelete(banner: AdminBanner) {
    const ok = await confirm({
      title: "Delete this banner?",
      description: `Banner "${banner.title ?? "(untitled)"}" will be permanently removed from the list and no longer shown on the landing page.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    setDeletingId(banner.id);
    try {
      await deleteBanner(banner.id);
      setBanners((arr) => arr.filter((b) => b.id !== banner.id));
      toast.success("Banner deleted");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to delete banner"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {/* Toolbar: count kiri + tombol kanan */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {banners.length} banners total
        </div>
        <Button variant="gold" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          New Banner
        </Button>
      </div>

      {banners.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">No banners yet</p>
          <p className="text-xs text-muted-foreground mb-4">
            Upload your first banner to show it on the landing page.
          </p>
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New Banner
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium w-16">Photo</th>
                  <th className="px-4 py-3 font-medium">Title & Description</th>
                  <th className="px-4 py-3 font-medium w-24">Status</th>
                  <th className="px-4 py-3 font-medium w-20 text-center">Order</th>
                  <th className="px-4 py-3 font-medium w-44">Period</th>
                  <th className="px-4 py-3 font-medium w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {banners.map((b) => (
                  <BannerRow
                    key={b.id}
                    banner={b}
                    deleting={deletingId === b.id}
                    onEdit={() => setEditing(b)}
                    onDelete={() => handleDelete(b)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
  deleting,
  onEdit,
  onDelete,
}: {
  banner: AdminBanner;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const now = Date.now();
  const inWindow =
    (!banner.startsAt || banner.startsAt.getTime() <= now) &&
    (!banner.endsAt || banner.endsAt.getTime() >= now);
  const showing = banner.isActive && inWindow;

  return (
    <tr className="hover:bg-muted/30 transition">
      {/* Foto */}
      <td className="px-4 py-2.5 align-middle">
        <div className="relative h-10 w-16 rounded bg-zinc-900 overflow-hidden shrink-0">
          <Image
            src={banner.imageUrl}
            alt={banner.title ?? "Banner"}
            fill
            className="object-cover"
            sizes="64px"
          />
        </div>
      </td>

      {/* Judul + deskripsi */}
      <td className="px-4 py-2.5 align-middle min-w-0">
        <div className="font-medium text-sm truncate">
          {banner.title ?? <span className="text-muted-foreground italic">(untitled)</span>}
        </div>
        {banner.subtitle && (
          <div className="text-xs text-muted-foreground truncate mt-0.5 max-w-md">
            {banner.subtitle}
          </div>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-2.5 align-middle">
        <Badge
          variant={showing ? "default" : "secondary"}
          className="text-[10px] px-1.5 py-0.5"
        >
          {showing ? "Live" : !banner.isActive ? "Off" : "Out of Period"}
        </Badge>
      </td>

      {/* Urutan */}
      <td className="px-4 py-2.5 align-middle text-center text-xs text-muted-foreground tabular-nums">
        {banner.sortOrder}
      </td>

      {/* Periode */}
      <td className="px-4 py-2.5 align-middle text-xs text-muted-foreground">
        {banner.startsAt || banner.endsAt ? (
          <div className="flex items-center gap-1 whitespace-nowrap">
            <Calendar className="h-3 w-3 shrink-0" />
            <span className="tabular-nums">
              {banner.startsAt ? banner.startsAt.toISOString().slice(0, 10) : "—"}
              {" → "}
              {banner.endsAt ? banner.endsAt.toISOString().slice(0, 10) : "—"}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground/60">Always shown</span>
        )}
      </td>

      {/* Aksi */}
      <td className="px-4 py-2.5 align-middle text-right">
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit2 className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={deleting}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </td>
    </tr>
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
  const [content, setContent] = React.useState(banner?.content ?? "");
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
      toast.error("File too large (max 10MB)");
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
      toast.error("Select a banner photo first");
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
          content,
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
        toast.success("Banner updated");

        // Build updated banner shape buat callback
        onSaved({
          ...banner,
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          content: content.trim() || null,
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
        if (content.trim()) fd.append("content", content.trim());
        fd.append("sortOrder", String(sortOrder));
        fd.append("isActive", String(isActive));
        if (startsAt) fd.append("startsAt", startsAt);
        if (endsAt) fd.append("endsAt", endsAt);

        const { id } = await createBanner(fd);
        toast.success("Banner uploaded");

        onSaved({
          id,
          imageUrl: previewUrl ?? "",
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          content: content.trim() || null,
          sortOrder,
          isActive,
          startsAt: startsAt ? new Date(startsAt) : null,
          endsAt: endsAt ? new Date(endsAt) : null,
          createdAt: new Date(),
        });
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-lg my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">
            {isEdit ? "Edit banner" : "New banner"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60 transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Image preview + picker */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Banner photo *
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
                  Change photo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-[16/9] border-2 border-dashed border-border rounded-md flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
              >
                <ImageIcon className="h-8 w-8" />
                <span className="text-sm">Select photo</span>
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
            {/* Hint detail: rasio, rekomendasi resolusi, format, ukuran max */}
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground/70">
              <li>• Ratio 16:9 (landscape) — recommended 1920×1080 px</li>
              <li>• Format: JPG, PNG, WebP, or HEIC</li>
              <li>• Maximum size 10 MB</li>
            </ul>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Title (optional, max 80)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              maxLength={80}
              placeholder="e.g. Happy Hour Every Friday"
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Subtitle */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Description (optional, max 200)
            </label>
            <textarea
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value.slice(0, 200))}
              maxLength={200}
              rows={2}
              placeholder="e.g. Buy 1 get 1 free mocktail, 5-7pm"
              className="w-full px-3 py-2 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition resize-none text-sm"
            />
          </div>

          {/* Detail content — tampil di halaman detail promo (customer) */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Detail content (optional, max 5000)
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 5000))}
              maxLength={5000}
              rows={6}
              placeholder={
                "Full promo details shown when a customer taps this banner.\n\nExample:\nEnjoy 50% off all cocktails every Friday, 17:00–19:00.\n\nTerms:\n- Dine-in only\n- Cannot be combined with other promos"
              }
              className="w-full px-3 py-2 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {content.trim().length} / 5000 · Line breaks are preserved.
            </p>
          </div>

          {/* Sort + active */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Order (lower = top)
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
                {isActive ? "Active" : "Off"}
              </button>
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Start (optional)
              </label>
              <DatePicker value={startsAt} onChange={setStartsAt} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                End (optional)
              </label>
              <DatePicker value={endsAt} onChange={setEndsAt} />
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
              Cancel
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Create banner"
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
