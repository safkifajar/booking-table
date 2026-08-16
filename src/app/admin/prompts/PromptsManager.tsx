"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Edit2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { addPrompt, updatePrompt, deletePrompt } from "@/lib/prompt-actions";
import type { PromptItem } from "@/lib/prompt-actions";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Kelola master pertanyaan prompt (ice-breaker) onboarding. Pola sama dgn
 * HobbiesManager: tabel + search + add/edit/delete via dialog.
 */
export function PromptsManager({ prompts }: { prompts: PromptItem[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [formMode, setFormMode] = React.useState<
    { mode: "create" } | { mode: "edit"; item: PromptItem } | null
  >(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? prompts.filter((p) => p.text.toLowerCase().includes(q))
    : prompts;

  async function handleDelete(p: PromptItem) {
    const ok = await confirm({
      title: "Delete prompt?",
      description: `"${p.text}" will be removed from the options. Customers who already answered it keep their answer.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(p.id);
    try {
      await deletePrompt(p.id);
      toast.success("Prompt deleted");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to delete"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompt…"
            className="w-full h-10 pl-8 pr-3 bg-input border border-border rounded-md text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <Button
          variant="gold"
          size="sm"
          onClick={() => setFormMode({ mode: "create" })}
        >
          <Plus className="h-4 w-4" /> Add Prompt
        </Button>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-4 py-2.5">Prompt</th>
              <th className="text-right px-4 py-2.5 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{p.text}</td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFormMode({ mode: "edit", item: p })}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(p)}
                      disabled={deletingId === p.id}
                      className="text-red-400 hover:text-red-300"
                    >
                      {deletingId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={2}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  {q ? "No matching prompts." : "No prompts yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {formMode && (
        <PromptFormDialog
          mode={formMode}
          onClose={() => setFormMode(null)}
          onSaved={() => {
            setFormMode(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function PromptFormDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: { mode: "create" } | { mode: "edit"; item: PromptItem };
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode.mode === "edit";
  const [text, setText] = React.useState(isEdit ? mode.item.text : "");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      toast.error("Prompt text is required");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const res = await updatePrompt({ id: mode.item.id, text: text.trim() });
        if (!res.ok) {
          toast.error(res.error ?? "Failed to save");
          setSaving(false);
          return;
        }
        toast.success("Prompt updated");
      } else {
        const res = await addPrompt({ text: text.trim() });
        if (!res.ok) {
          toast.error(res.error ?? "Failed to save");
          setSaving(false);
          return;
        }
        toast.success("Prompt added");
      }
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save prompt"));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Prompt" : "Add Prompt"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Prompt text
            </label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              maxLength={120}
              autoFocus
              placeholder="e.g. Tonight I'm in the mood for…"
              className="w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : isEdit ? (
                "Save"
              ) : (
                "Add Prompt"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
