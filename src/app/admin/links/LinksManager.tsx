"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Edit2,
  Loader2,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Copy,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ConfirmDialog";
import { LinkIcon } from "@/components/LinkIcon";
import { LINK_ICONS } from "@/lib/link-icons";
import {
  createLink,
  updateLink,
  deleteLink,
  reorderLinks,
  updateLinkTreeConfig,
  type BuiltInDefaults,
  type LinkTreeItem,
} from "@/lib/link-tree-actions";
import {
  BUILT_IN_ORDER_KEYS,
  type LinkTreeConfig,
} from "@/lib/settings-constants";
import { cn, getActionErrorMessage } from "@/lib/utils";

/**
 * Yang bisa diubah dari sebuah tautan BAWAAN lewat modal edit.
 *
 * Hanya URL: label, ikon & deskripsinya mengikuti data bar supaya tak perlu
 * diperbarui di dua tempat. `defaultUrl` = nilai otomatis yang berlaku kalau
 * kolomnya dikosongkan.
 */
interface BuiltInEdit {
  /** Kunci config penyimpan URL timpa — null = tak bisa ditimpa (WhatsApp). */
  urlKey: "appUrl" | "addressUrl" | null;
  /** Kunci config sakelar tampil/sembunyi. */
  showKey: "showApp" | "showWhatsapp" | "showAddress";
  defaultUrl: string;
  /** Alasan URL-nya terkunci — hanya untuk yang urlKey null. */
  lockedReason?: string;
}

interface Props {
  barId: string;
  initialLinks: LinkTreeItem[];
  initialConfig: LinkTreeConfig;
  publicUrl: string;
  /** Nilai otomatis tautan bawaan — dipakai sbg placeholder kolom timpa,
   *  supaya admin tahu tiap tautan menuju ke mana tanpa membuka halaman publik. */
  defaults: BuiltInDefaults;
}

export function LinksManager({
  barId,
  initialLinks,
  initialConfig,
  publicUrl,
  defaults,
}: Props) {
  const confirm = useConfirm();
  const [links, setLinks] = React.useState(initialLinks);
  const [config, setConfig] = React.useState(initialConfig);
  const [editing, setEditing] = React.useState<LinkTreeItem | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  /**
   * Nilai config yang TERAKHIR TERSIMPAN di server. Dibandingkan saat onBlur
   * supaya kolom yang cuma di-klik lalu ditinggalkan tak memicu simpan &
   * toast "Saved". Tak bisa membandingkan dengan `config`, karena state itu
   * sudah ikut berubah saat mengetik.
   */
  const savedConfig = React.useRef(initialConfig);

  async function handleDelete(link: LinkTreeItem) {
    const ok = await confirm({
      title: "Delete this link?",
      description: `"${link.label}" will be removed from the public page.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    setBusyId(link.id);
    try {
      const res = await deleteLink(link.id);
      if (!res.ok) {
        toast.error(res.error ?? "Failed to delete link");
        return;
      }
      setLinks((arr) => arr.filter((l) => l.id !== link.id));
      toast.success("Link deleted");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to delete link"));
    } finally {
      setBusyId(null);
    }
  }

  /** Naik/turun satu posisi, lalu simpan urutan penuh. */
  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= links.length) return;
    const reordered = [...links];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];

    // Urutan bawaan tersimpan di config. State config WAJIB ikut diperbarui:
    // saveConfig() mengirim `config` utuh, jadi menyalakan sakelar setelah
    // memindah urutan akan menulis balik posisi lama kalau tak disinkronkan.
    const orderPatch: Partial<LinkTreeConfig> = {};
    reordered.forEach((l, i) => {
      const key = BUILT_IN_ORDER_KEYS[l.id as keyof typeof BUILT_IN_ORDER_KEYS];
      if (key) orderPatch[key] = i + 1;
    });

    const prevLinks = links;
    const prevConfig = config;
    setLinks(reordered); // optimistis — urutan terasa langsung
    setConfig((c) => ({ ...c, ...orderPatch }));
    try {
      const res = await reorderLinks(
        barId,
        reordered.map((l) => l.id)
      );
      if (!res.ok) {
        setLinks(prevLinks); // kembalikan kalau gagal
        setConfig(prevConfig);
        toast.error(res.error ?? "Failed to save order");
        return;
      }
      savedConfig.current = { ...savedConfig.current, ...orderPatch };
    } catch (err) {
      setLinks(prevLinks);
      setConfig(prevConfig);
      toast.error(getActionErrorMessage(err, "Failed to save order"));
    }
  }

  /**
   * Apa yang bisa diedit dari tautan bawaan — null untuk tautan kustom.
   *
   * WhatsApp sengaja `urlKey: null`: nomornya satu sumber di Settings →
   * Customer service. Kalau bisa ditimpa di sini, admin harus ingat
   * memperbarui dua tempat setiap nomornya berganti.
   */
  function builtInEdit(id: string): BuiltInEdit | null {
    switch (id) {
      case "builtin-app":
        return {
          urlKey: "appUrl",
          showKey: "showApp",
          defaultUrl: defaults.appUrl,
        };
      case "builtin-wa":
        return {
          urlKey: null,
          showKey: "showWhatsapp",
          defaultUrl: `https://wa.me/${defaults.whatsappNumber}`,
          lockedReason: `Uses ${defaults.whatsappNumber} from Settings → Customer service. Change it there and every link updates.`,
        };
      case "builtin-address":
        return {
          urlKey: "addressUrl",
          showKey: "showAddress",
          defaultUrl: defaults.addressUrl,
        };
      default:
        return null;
    }
  }

  /** Simpan hasil edit tautan bawaan (URL timpa + tampil/sembunyi). */
  async function saveBuiltIn(
    id: string,
    edit: BuiltInEdit,
    values: { url: string; isActive: boolean }
  ): Promise<boolean> {
    const patch: Partial<LinkTreeConfig> = { [edit.showKey]: values.isActive };
    if (edit.urlKey) patch[edit.urlKey] = values.url.trim();

    const ok = await saveConfig(patch);
    if (!ok) return false;

    setLinks((arr) =>
      arr.map((l) =>
        l.id === id
          ? {
              ...l,
              isActive: values.isActive,
              // Kosong = kembali ke nilai otomatis.
              url: values.url.trim() || edit.defaultUrl,
            }
          : l
      )
    );
    return true;
  }

  /** @returns true kalau tersimpan — pemanggil bisa mengembalikan tampilannya. */
  async function saveConfig(
    patch: Partial<LinkTreeConfig>,
    silentIfSame = false
  ): Promise<boolean> {
    if (silentIfSame) {
      const unchanged = Object.entries(patch).every(
        ([k, v]) => savedConfig.current[k as keyof LinkTreeConfig] === v
      );
      if (unchanged) return true;
    }
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      const res = await updateLinkTreeConfig(barId, next);
      if (!res.ok) {
        setConfig(config);
        toast.error(res.error ?? "Failed to save");
        return false;
      }
      savedConfig.current = next;
      toast.success("Saved");
      return true;
    } catch (err) {
      setConfig(config);
      toast.error(getActionErrorMessage(err, "Failed to save"));
      return false;
    }
  }

  return (
    <>
      {/* URL publik — yang ditempel ke bio Instagram */}
      {publicUrl && (
        <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Public URL
            </p>
            <p className="text-sm font-mono truncate">{publicUrl}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                toast.success("URL copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </Button>
          </div>
        </Card>
      )}

      {/* Judul & subjudul halaman */}
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Page header</h2>
          <p className="text-xs text-muted-foreground">
            Shown above the links. Leave the headline empty to use the bar name.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              Headline
            </span>
            <input
              type="text"
              value={config.headline}
              maxLength={60}
              onChange={(e) =>
                setConfig((c) => ({ ...c, headline: e.target.value }))
              }
              onBlur={() => saveConfig({ headline: config.headline }, true)}
              placeholder="SOHO Social House"
              className="mt-1 w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              Tagline
            </span>
            <input
              type="text"
              value={config.tagline}
              maxLength={120}
              onChange={(e) =>
                setConfig((c) => ({ ...c, tagline: e.target.value }))
              }
              onBlur={() => saveConfig({ tagline: config.tagline }, true)}
              placeholder="Purwokerto · Open daily"
              className="mt-1 w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </label>
        </div>
      </Card>

      {/* SATU daftar: bawaan & kustom bercampur, semuanya bisa diurutkan.
          Yang bawaan tak bisa dihapus — hanya disembunyikan lewat sakelar. */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold">Your links</h2>
            <p className="text-xs text-muted-foreground">
              {links.length} link{links.length === 1 ? "" : "s"} · drag order
              with the arrows — this is the order visitors see
            </p>
          </div>
          <Button variant="gold" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New link
          </Button>
        </div>

        <div className="space-y-2">
          {links.map((l, i) => {
            const builtIn = builtInEdit(l.id);
            return (
              <div
                key={l.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3"
              >
                {/* Urutan */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === links.length - 1}
                    onClick={() => move(i, 1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                  <LinkIcon name={l.icon} className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{l.label}</p>
                    {!l.isActive && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1 py-0"
                      >
                        Hidden
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {l.url}
                  </p>
                </div>

                {/* Bawaan: edit saja — tak bisa dihapus, hanya disembunyikan
                    lewat modal editnya. */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  {!builtIn && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(l)}
                      disabled={busyId === l.id}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      {busyId === l.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </Card>

      {(creating || editing) && (
        <LinkFormModal
          barId={barId}
          initial={editing}
          builtIn={editing ? builtInEdit(editing.id) : null}
          onSaveBuiltIn={saveBuiltIn}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(saved, isNew) => {
            setLinks((arr) =>
              isNew
                ? [...arr, saved]
                : arr.map((l) => (l.id === saved.id ? saved : l))
            );
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Toggle on/off — pola sama dengan switch di SettingsManager (project tak
 * punya komponen Switch bersama; pakai <button role="switch"> supaya tetap
 * dapat semantik aksesibilitas).
 */
function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? `Turn off ${label}` : `Turn on ${label}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function LinkFormModal({
  barId,
  initial,
  builtIn,
  onSaveBuiltIn,
  onClose,
  onSaved,
}: {
  barId: string;
  initial: LinkTreeItem | null;
  /**
   * Diisi kalau yang diedit adalah tautan BAWAAN. Hanya URL & tampil/sembunyi
   * yang bisa diubah: label, ikon & deskripsi ikut data bar supaya tak perlu
   * diperbarui di dua tempat saat data itu berubah.
   */
  builtIn: BuiltInEdit | null;
  /** Penyimpan khusus bawaan — datanya di config, bukan di tabel bar_links. */
  onSaveBuiltIn: (
    id: string,
    edit: BuiltInEdit,
    values: { url: string; isActive: boolean }
  ) => Promise<boolean>;
  onClose: () => void;
  onSaved: (saved: LinkTreeItem, isNew: boolean) => void;
}) {
  const isNew = !initial;
  const [label, setLabel] = React.useState(initial?.label ?? "");
  // Bawaan: kolom URL menampilkan TIMPAAN saja. Yang sedang berlaku tampil
  // sebagai placeholder, supaya jelas mana yang diketik admin & mana otomatis.
  const [url, setUrl] = React.useState(
    builtIn ? (initial?.url === builtIn.defaultUrl ? "" : (initial?.url ?? "")) : (initial?.url ?? "")
  );
  const [description, setDescription] = React.useState(
    initial?.description ?? ""
  );
  const [icon, setIcon] = React.useState(initial?.icon ?? "link");
  const [isActive, setIsActive] = React.useState(initial?.isActive ?? true);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    // Bawaan: hanya URL & tampil/sembunyi yang disimpan, dan URL boleh kosong
    // (= kembali ke nilai otomatis). Tujuannya pun beda — config, bukan tabel.
    if (builtIn && initial) {
      setSaving(true);
      const ok = await onSaveBuiltIn(initial.id, builtIn, { url, isActive });
      if (ok) onClose();
      else setSaving(false);
      return;
    }

    if (!label.trim() || !url.trim()) return;
    setSaving(true);
    try {
      const payload = {
        label: label.trim(),
        url: url.trim(),
        icon,
        description: description.trim(),
        isActive,
      };
      const res = isNew
        ? await createLink(barId, payload)
        : await updateLink(initial!.id, payload);
      if (!res.ok) {
        toast.error(res.error ?? "Failed to save link");
        setSaving(false);
        return;
      }
      toast.success(isNew ? "Link added" : "Link saved");
      // Reload supaya URL hasil normalisasi server (mis. https:// otomatis)
      // & sortOrder yang benar terbaca — jangan menebak di client.
      window.location.reload();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save link"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-base font-semibold">
            {isNew ? "New link" : builtIn ? initial!.label : "Edit link"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {/* Bawaan: label, ikon & deskripsi ikut data bar — tak diminta di
              sini supaya tak perlu diperbarui di dua tempat. */}
          {!builtIn && (
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                Label
              </span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="Follow us on Instagram"
                className="mt-1 w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              URL
            </span>
            <input
              type="text"
              value={builtIn && !builtIn.urlKey ? builtIn.defaultUrl : url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={500}
              // WhatsApp: nomornya satu sumber di Settings, jadi terkunci.
              disabled={!!builtIn && !builtIn.urlKey}
              placeholder={
                builtIn
                  ? builtIn.defaultUrl || "Paste a link"
                  : "instagram.com/sohosocialhouse"
              }
              title={builtIn ? builtIn.defaultUrl : undefined}
              className="mt-1 w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 disabled:opacity-60"
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {builtIn
                ? (builtIn.lockedReason ??
                  "Leave empty to keep using the address from your bar data.")
                : "https:// is added automatically if you leave it out."}
            </span>
          </label>

          {!builtIn && (
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              Description (optional)
            </span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={120}
              placeholder="Daily photos and event updates"
              className="mt-1 w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </label>
          )}

          {/* Pemilih ikon — grid kurasi, bukan seluruh lucide (bundle & pilihan
              terlalu banyak justru menyulitkan). */}
          {!builtIn && (
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Icon
            </span>
            <div className="mt-1.5 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {LINK_ICONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.label}
                  aria-label={opt.label}
                  aria-pressed={icon === opt.value}
                  onClick={() => setIcon(opt.value)}
                  className={cn(
                    "flex h-10 items-center justify-center rounded-md border transition",
                    icon === opt.value
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <LinkIcon name={opt.value} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Visible</p>
              <p className="text-xs text-muted-foreground">
                Turn off to hide it without deleting
              </p>
            </div>
            <Toggle checked={isActive} onChange={setIsActive} label="visibility" />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="gold"
              // Bawaan: URL boleh kosong (= pakai nilai otomatis), dan
              // labelnya memang tak diminta di form ini.
              disabled={saving || (!builtIn && (!label.trim() || !url.trim()))}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isNew ? "Add link" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
