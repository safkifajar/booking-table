"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Eye, Pencil, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/MarkdownView";
import { upsertLegalDoc, type LegalDoc, type LegalKey } from "@/lib/legal-actions";
import { cn, getActionErrorMessage } from "@/lib/utils";

const TABS: { key: LegalKey; label: string; publicPath: string }[] = [
  { key: "privacy", label: "Privacy Policy", publicPath: "/privacy" },
  { key: "terms", label: "Term & Conditions", publicPath: "/terms" },
];

export function LegalManager({
  initial,
}: {
  initial: Record<LegalKey, LegalDoc>;
}) {
  const [active, setActive] = React.useState<LegalKey>("privacy");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
              active === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {TABS.map(
        (t) =>
          active === t.key && (
            <DocEditor key={t.key} doc={initial[t.key]} publicPath={t.publicPath} />
          )
      )}
    </div>
  );
}

function DocEditor({
  doc,
  publicPath,
}: {
  doc: LegalDoc;
  publicPath: string;
}) {
  const [title, setTitle] = React.useState(doc.title);
  const [content, setContent] = React.useState(doc.content);
  const [preview, setPreview] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!title.trim()) {
      toast.error("Judul wajib diisi");
      return;
    }
    setSaving(true);
    try {
      await upsertLegalDoc({ key: doc.key, title: title.trim(), content });
      toast.success("Dokumen tersimpan");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-muted-foreground">
          {doc.updated_at
            ? `Terakhir diperbarui ${new Date(doc.updated_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`
            : "Belum pernah disimpan"}
        </p>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={publicPath} target="_blank">
              <ExternalLink className="h-3.5 w-3.5" /> Lihat publik
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? (
              <>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" /> Preview
              </>
            )}
          </Button>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
          Judul
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
          Konten (Markdown)
        </label>
        {preview ? (
          <div className="min-h-[300px] rounded-md border border-border bg-card p-4">
            <MarkdownView content={content} />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            placeholder={"## Judul Bagian\n\nIsi paragraf...\n\n- Poin 1\n- Poin 2"}
            className="w-full rounded-md bg-input border border-border text-sm p-3 font-mono leading-relaxed focus:outline-none focus:border-primary/60 resize-y"
          />
        )}
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Mendukung Markdown: <code># Heading</code>, <code>**tebal**</code>,{" "}
          <code>- list</code>, <code>[teks](url)</code>.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="gold" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
            </>
          ) : (
            "Simpan"
          )}
        </Button>
      </div>
    </div>
  );
}
