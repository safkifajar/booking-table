"use client";

import * as React from "react";
import { toast } from "sonner";
import { X, Globe, UserPlus, Lock } from "lucide-react";
import { updateSessionInfo } from "@/lib/actions";
import { getActionErrorMessage, cn } from "@/lib/utils";
import type { SessionVisibility } from "@/types/db";

const VIBE_OPTIONS = [
  "chill",
  "networking",
  "celebrate",
  "date",
  "after-work",
  "loud",
];

/**
 * Modal edit informasi meja (session): deskripsi, visibility, vibe.
 * Dipakai host / staff dari halaman session (tombol Edit di Table Information).
 */
export function EditTableInfoModal({
  sessionId,
  initialTitle,
  initialVisibility,
  initialVibes,
  onClose,
  onSaved,
}: {
  sessionId: string;
  initialTitle: string | null;
  initialVisibility: SessionVisibility;
  initialVibes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState(initialTitle ?? "");
  const [visibility, setVisibility] =
    React.useState<SessionVisibility>(initialVisibility);
  const [vibes, setVibes] = React.useState<string[]>(initialVibes);
  const [saving, setSaving] = React.useState(false);

  function toggleVibe(v: string) {
    setVibes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v].slice(0, 5)
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await updateSessionInfo({
        sessionId,
        title: title.trim() || null,
        visibility,
        vibeTags: vibes,
      });
      if (res.ok === false) {
        toast.error(res.error);
        setSaving(false);
        return;
      }
      toast.success("Table info updated");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to update"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold">Edit table info</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Deskripsi */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              placeholder="Add a short note (e.g. birthday, casual meetup)…"
              rows={2}
              maxLength={80}
              className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary/60 transition resize-none"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {title.length}/80
            </p>
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium mb-2">Who can join?</label>
            <div className="grid grid-cols-3 gap-2">
              <VisibilityOption
                icon={<Globe className="h-4 w-4" />}
                label="Public"
                desc="Anyone"
                active={visibility === "public"}
                onClick={() => setVisibility("public")}
              />
              <VisibilityOption
                icon={<UserPlus className="h-4 w-4" />}
                label="Friends"
                desc="Friends only"
                active={visibility === "friends"}
                onClick={() => setVisibility("friends")}
              />
              <VisibilityOption
                icon={<Lock className="h-4 w-4" />}
                label="Invite"
                desc="Invite users"
                active={visibility === "invite_only"}
                onClick={() => setVisibility("invite_only")}
              />
            </div>
          </div>

          {/* Vibe */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Vibe{" "}
              <span className="text-muted-foreground font-normal">(max 5)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {VIBE_OPTIONS.map((v) => {
                const active = vibes.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleVibe(v)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition",
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-md border border-border text-sm font-medium hover:bg-muted/50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VisibilityOption({
  icon,
  label,
  desc,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-md border p-2.5 text-center transition",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] text-muted-foreground">{desc}</span>
    </button>
  );
}
