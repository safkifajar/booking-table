"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  resolveMoveRequest,
  type MoveRequestRow,
} from "@/lib/move-approval-actions";
import { getActionErrorMessage } from "@/lib/utils";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: {
      label: "Pending",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    },
    approved: {
      label: "Approved",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-red-500/15 text-red-300 border-red-500/30",
    },
    cancelled: {
      label: "Cancelled",
      cls: "bg-muted text-muted-foreground border-border",
    },
  };
  const s = map[status] ?? map.cancelled;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full border ${s.cls} shrink-0`}
    >
      {s.label}
    </span>
  );
}

/**
 * Daftar request pindah meja untuk staff (waiter/kasir) — konten tab "Pindah
 * Meja". Pending bisa di-approve/tolak; yg sudah diproses tetap tampil sbg
 * riwayat dgn badge status.
 */
export function MoveRequestsPanel({
  requests,
}: {
  requests: MoveRequestRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function resolve(id: string, approve: boolean) {
    setBusy(id);
    try {
      await resolveMoveRequest({ requestId: id, approve });
      toast.success(approve ? "Table move approved" : "Request rejected");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to process"));
    } finally {
      setBusy(null);
    }
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No table move requests yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {requests.map((r) => (
        <div
          key={r.id}
          className="rounded-lg border border-border bg-card p-3 flex items-center gap-3 flex-wrap"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">
                {r.requester_name}: Table {r.from_label} →{" "}
                <span className="text-primary">{r.to_label}</span>
              </p>
              <StatusBadge status={r.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {fmt(r.reservation_at)} – {fmt(r.reservation_end_at)}
            </p>
          </div>
          {r.status === "pending" && (
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="gold"
                disabled={busy === r.id}
                onClick={() => resolve(r.id, true)}
              >
                {busy === r.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === r.id}
                onClick={() => resolve(r.id, false)}
                className="text-red-400"
              >
                <X className="h-4 w-4" /> Reject
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Jumlah request pending (utk badge tab). */
export function countPending(requests: MoveRequestRow[]): number {
  return requests.filter((r) => r.status === "pending").length;
}

export { ArrowRightLeft as MoveIcon };
