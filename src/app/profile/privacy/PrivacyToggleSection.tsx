"use client";

import * as React from "react";
import { Lock, Loader2 } from "lucide-react";
import { updatePrivacy } from "@/lib/actions";
import { getActionErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Toggle "Private Account" ala Instagram. Aktif = akun privat: user lain
 * hanya lihat data yg tampil di list network (foto, nama, umur, area,
 * education, rating, hobbies dasar, badge At SOHO). Data lain (bio, sosmed,
 * prompts, dll) diblur+kunci di halaman detail, dan hangout history
 * disembunyikan total.
 */
export function PrivacyToggleSection({ initial }: { initial: boolean }) {
  const [isPrivate, setIsPrivate] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  async function toggle() {
    if (busy) return;
    const next = !isPrivate;
    setBusy(true);
    // Optimistic.
    setIsPrivate(next);
    try {
      await updatePrivacy(next);
      toast.success(
        next ? "Your account is now private" : "Your account is now public"
      );
    } catch (err) {
      setIsPrivate(!next); // rollback
      toast.error(getActionErrorMessage(err, "Failed to update privacy"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Kartu toggle */}
      <div className="rounded-xl border border-border bg-card/70 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 text-primary">
            <Lock className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Private account</div>
            <div className="text-xs text-muted-foreground">
              {isPrivate ? "On" : "Off"}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            aria-label={
              isPrivate ? "Turn off private account" : "Turn on private account"
            }
            onClick={toggle}
            disabled={busy}
            className={[
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              isPrivate ? "bg-primary" : "bg-muted-foreground/30",
            ].join(" ")}
          >
            <span
              className={[
                "inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
                isPrivate ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            >
              {busy && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Penjelasan */}
      <div className="rounded-xl border border-border bg-card/40 px-4 py-4 text-xs text-muted-foreground leading-relaxed space-y-2">
        <p>
          When your account is private, other members can still find you in the
          network and see your basic card info — photos, name, age, area,
          education, and rating.
        </p>
        <p>
          On your detail page, the rest — bio, social links, interests, and
          prompts — is locked behind a blur with a{" "}
          <Lock className="inline h-3 w-3 -mt-0.5" /> icon, and your hangout
          history is hidden.
        </p>
      </div>
    </div>
  );
}
