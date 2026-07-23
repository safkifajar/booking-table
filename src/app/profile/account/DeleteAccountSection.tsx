"use client";

import * as React from "react";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { getActionErrorMessage } from "@/lib/utils";
import { requestAccountDeletion } from "@/lib/account-deletion-actions";

/**
 * Danger zone di halaman Edit Account — ajukan hapus akun. Alasan WAJIB.
 * Pengajuan direview admin; approve = akun dinonaktifkan (soft delete).
 */
export function DeleteAccountSection() {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit() {
    if (reason.trim().length < 3) return;
    setSubmitting(true);
    try {
      const res = await requestAccountDeletion({ reason: reason.trim() });
      if (!res.ok) {
        // Guard (sesi aktif / sudah pending) → tampilkan pesannya utuh.
        toast.error(res.error);
        return;
      }
      toast.success(
        "Deletion request sent. An admin will review it. Your account stays active until approved."
      );
      setOpen(false);
      setReason("");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to submit deletion request"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-5">
      <h3 className="text-base font-semibold text-red-400">Danger zone</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Request to delete your account. An admin reviews it — once approved your
        account is deactivated and you can no longer sign in. Your past
        transactions are kept for records.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-2 rounded-md border border-red-500/40 px-3.5 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 transition"
      >
        <Trash2 className="h-4 w-4" />
        Request account deletion
      </button>

      {/* Dialog — alasan WAJIB. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !submitting && setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="h-10 w-10 rounded-full border border-red-500/30 bg-red-500/10 flex items-center justify-center shrink-0 text-red-400">
                <Trash2 className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-semibold">
                  Request account deletion
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This sends a request to the admin. Once approved, your account
                  is deactivated and you can no longer sign in. Your past
                  transactions are kept for records.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Reason <span className="text-red-400">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                placeholder="Tell us why you want to delete your account…"
                rows={3}
                maxLength={500}
                autoFocus
                className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary/60 transition resize-none"
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">
                {reason.length}/500
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="flex-1 rounded-md border border-border py-2.5 text-sm font-medium hover:bg-muted/50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || reason.trim().length < 3}
                className="flex-1 rounded-md bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Submit request
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
