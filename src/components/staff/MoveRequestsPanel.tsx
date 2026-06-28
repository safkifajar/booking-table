"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  resolveMoveRequest,
  type PendingMoveRequest,
} from "@/lib/move-approval-actions";
import { getActionErrorMessage } from "@/lib/utils";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Panel request pindah meja untuk staff (waiter/kasir). Approve → eksekusi
 * pindah; Tolak → batalkan. Customer dapat notif keputusan.
 */
export function MoveRequestsPanel({
  requests,
}: {
  requests: PendingMoveRequest[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  if (requests.length === 0) return null;

  async function resolve(id: string, approve: boolean) {
    setBusy(id);
    try {
      await resolveMoveRequest({ requestId: id, approve });
      toast.success(approve ? "Pindah meja disetujui" : "Request ditolak");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal memproses"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 mb-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-amber-300">
        <ArrowRightLeft className="h-4 w-4" /> Request Pindah Meja
        <span className="text-xs font-normal opacity-70">
          ({requests.length})
        </span>
      </div>
      <div className="space-y-2">
        {requests.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-border bg-card p-3 flex items-center gap-3 flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {r.requester_name}: Meja {r.from_label} →{" "}
                <span className="text-primary">{r.to_label}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {fmt(r.reservation_at)} – {fmt(r.reservation_end_at)}
              </p>
            </div>
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
                <X className="h-4 w-4" /> Tolak
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
