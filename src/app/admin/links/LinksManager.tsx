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
  const [savingConfig, setSavingConfig] = React.useState(false);

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
   * Keterangan & kolom timpa tiap tautan bawaan — null utk tautan kustom.
   *
   * WhatsApp sengaja TANPA `fields`: nomornya satu sumber di Settings →
   * Customer service. Kalau bisa ditimpa di sini, admin harus ingat
   * memperbarui dua tempat setiap nomornya berganti.
   */
  function builtInConfig(id: string) {
    switch (id) {
      case "builtin-app":
        return {
          hint: "Sends visitors to the customer app",
          fields: {
            labelKey: "appLabel",
            urlKey: "appUrl",
            labelPlaceholder: defaults.appLabel,
            urlPlaceholder: defaults.appUrl,
          },
        } as const;
      case "builtin-wa":
        return {
          hint: `Uses ${defaults.whatsappNumber} from Settings`,
          fields: null,
        } as const;
      case "builtin-address":
        return {
          hint: defaults.addressUrl
            ? "Opens Google Maps with the bar address"
            : "Add your address in Settings, or type a URL below",
          fields: {
            labelKey: "addressLabel",
            urlKey: "addressUrl",
            labelPlaceholder: defaults.addressLabel,
            urlPlaceholder:
              defaults.addressUrl ||
              "Paste a Google Maps link — no address set",
          },
        } as const;
      default:
        return null;
    }
  }

  /** Sakelar tampil/sembunyi bawaan — sekaligus perbarui daftarnya. */
  async function toggleBuiltIn(id: string, visible: boolean) {
    const key =
      id === "builtin-app"
        ? "showApp"
        : id === "builtin-wa"
          ? "showWhatsapp"
          : "showAddress";
    setLinks((arr) =>
      arr.map((l) => (l.id === id ? { ...l, isActive: visible } : l))
    );
    // Gagal simpan → kembalikan sakelarnya, jangan biarkan layar berbohong.
    const ok = await saveConfig({ [key]: visible });
    if (!ok) {
      setLinks((arr) =>
        arr.map((l) => (l.id === id ? { ...l, isActive: !visible } : l))
      );
    }
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
    setSavingConfig(true);
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
    } finally {
      setSavingConfig(false);
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
            const builtIn = builtInConfig(l.id);
            return (
              <div
                key={l.id}
                className="rounded-lg border border-border bg-background/40 p-3 space-y-3"
              >
                <div className="flex items-center gap-3">
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
                      {builtIn && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0"
                        >
                          Built-in
                        </Badge>
                      )}
                      {!l.isActive && !builtIn && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0"
                        >
                          Hidden
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {builtIn ? builtIn.hint : l.url}
                    </p>
                  </div>

                  {/* Bawaan: sakelar tampil/sembunyi, tanpa tombol hapus.
                      Kustom: edit & hapus seperti biasa. */}
                  <div className="flex items-center gap-1 shrink-0">
                    {builtIn ? (
                      <Toggle
                        checked={l.isActive}
                        onChange={(v) => toggleBuiltIn(l.id, v)}
                        disabled={savingConfig}
                        label={l.label}
                      />
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(l)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
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
                      </>
                    )}
                  </div>
                </div>

                {/* Kolom timpa bawaan — hanya saat tautannya ditampilkan.
                    WhatsApp sengaja tak punya: nomornya satu sumber di
                    Settings, agar tak perlu diperbarui di dua tempat. */}
                {builtIn?.fields && l.isActive && (
                  <OverrideFields
                    label={config[builtIn.fields.labelKey]}
                    url={config[builtIn.fields.urlKey]}
                    labelPlaceholder={builtIn.fields.labelPlaceholder}
                    urlPlaceholder={builtIn.fields.urlPlaceholder}
                    onLabelChange={(v) =>
                      setConfig((c) => ({ ...c, [builtIn.fields!.labelKey]: v }))
                    }
                    onUrlChange={(v) =>
                      setConfig((c) => ({ ...c, [builtIn.fields!.urlKey]: v }))
                    }
                    onCommit={() =>
                      saveConfig({
                        [builtIn.fields!.labelKey]:
                          config[builtIn.fields!.labelKey],
                        [builtIn.fields!.urlKey]: config[builtIn.fields!.urlKey],
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Built-in links can be hidden but not deleted. The greyed-out text in
          their fields is what they use right now — leave a field empty to keep
          it in sync with your bar data.
        </p>
      </Card>

      {(creating || editing) && (
        <LinkFormModal
          barId={barId}
          initial={editing}
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

/**
 * Kolom label & URL untuk MENIMPA tautan bawaan.
 *
 * Dibiarkan KOSONG = pakai nilai otomatis dari data bar (placeholder abu-abu
 * menunjukkan nilai itu). Admin hanya mengisi kalau ingin menimpanya — mis.
 * titik Google Maps yang lebih tepat daripada hasil pencarian teks.
 */
function OverrideFields({
  label,
  url,
  labelPlaceholder,
  urlPlaceholder,
  onLabelChange,
  onUrlChange,
  onCommit,
}: {
  label: string;
  url: string;
  /** Nilai OTOMATIS yang berlaku saat kolom dibiarkan kosong. */
  labelPlaceholder: string;
  urlPlaceholder: string;
  onLabelChange: (v: string) => void;
  onUrlChange: (v: string) => void;
  onCommit: () => void;
}) {
  // Nilai tiap kolom saat difokus — pembanding untuk memutuskan perlu simpan.
  // Dipisah per kolom agar tak bergantung pada urutan blur/focus browser.
  const focusedLabel = React.useRef("");
  const focusedUrl = React.useRef("");
  return (
    // onFocus mencatat nilai awal; onBlur hanya menyimpan kalau benar-benar
    // berubah, supaya klik-lalu-tinggalkan tak memicu toast "Saved".
    <div className="grid gap-2 sm:grid-cols-2 pl-0 sm:pl-[4.5rem]">
      <input
        type="text"
        value={label}
        maxLength={60}
        onChange={(e) => onLabelChange(e.target.value)}
        onFocus={(e) => {
          focusedLabel.current = e.target.value;
        }}
        onBlur={(e) => {
          if (e.target.value !== focusedLabel.current) onCommit();
        }}
        placeholder={labelPlaceholder}
        title={labelPlaceholder}
        className="h-9 px-3 rounded-md bg-input border border-border text-xs focus:outline-none focus:border-primary/60"
      />
      <input
        type="text"
        value={url}
        maxLength={500}
        onChange={(e) => onUrlChange(e.target.value)}
        onFocus={(e) => {
          focusedUrl.current = e.target.value;
        }}
        onBlur={(e) => {
          if (e.target.value !== focusedUrl.current) onCommit();
        }}
        placeholder={urlPlaceholder}
        // URL bawaan sering lebih panjang dari kolomnya — hover utk penuh.
        title={urlPlaceholder}
        className="h-9 px-3 rounded-md bg-input border border-border text-xs focus:outline-none focus:border-primary/60"
      />
    </div>
  );
}

function LinkFormModal({
  barId,
  initial,
  onClose,
  onSaved,
}: {
  barId: string;
  initial: LinkTreeItem | null;
  onClose: () => void;
  onSaved: (saved: LinkTreeItem, isNew: boolean) => void;
}) {
  const isNew = !initial;
  const [label, setLabel] = React.useState(initial?.label ?? "");
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? ""
  );
  const [icon, setIcon] = React.useState(initial?.icon ?? "link");
  const [isActive, setIsActive] = React.useState(initial?.isActive ?? true);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !url.trim() || saving) return;
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
            {isNew ? "New link" : "Edit link"}
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

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              URL
            </span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={500}
              placeholder="instagram.com/sohosocialhouse"
              className="mt-1 w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              https:// is added automatically if you leave it out.
            </span>
          </label>

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

          {/* Pemilih ikon — grid kurasi, bukan seluruh lucide (bundle & pilihan
              terlalu banyak justru menyulitkan). */}
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
              disabled={saving || !label.trim() || !url.trim()}
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
