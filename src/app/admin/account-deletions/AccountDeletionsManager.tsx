"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Loader2, UserX, Clock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ConfirmDialog";
import { initials, formatRelativeTime, getActionErrorMessage } from "@/lib/utils";
import {
  resolveAccountDeletion,
  type AccountDeletionRequestItem,
} from "@/lib/account-deletion-actions";

/**
 * Daftar pengajuan hapus akun. Pending → tombol Approve/Reject; sisanya read-only
 * (record). Approve dikonfirmasi dulu (destruktif — menonaktifkan akun).
 */
export function AccountDeletionsManager({
  requests,
}: {
  requests: AccountDeletionRequestItem[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const pending = requests.filter((r) => r.status === "pending");
  const resolved = requests.filter((r) => r.status !== "pending");

  async function handle(r: AccountDeletionRequestItem, approve: boolean) {
    if (approve) {
      const ok = await confirm({
        title: `Deactivate ${r.requester_name}'s account?`,
        description:
          "Their account will be set inactive — they can no longer sign in. Past transactions are kept. This can be undone by re-activating the account in Manage Customer.",
        confirmText: "Approve & deactivate",
        cancelText: "Cancel",
        variant: "danger",
      });
      if (!ok) return;
    }
    setBusyId(r.id);
    try {
      await resolveAccountDeletion({ requestId: r.id, approve });
      toast.success(approve ? "Account deactivated" : "Request declined");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to process request"));
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <UserX className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium mb-1">No deletion requests</p>
        <p className="text-xs text-muted-foreground">
          When a customer requests account deletion, it appears here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending — perlu aksi */}
      <div>
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <Card className="p-6 text-center border-dashed">
            <p className="text-sm text-muted-foreground">
              No pending requests.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <Card key={r.id} className="p-4">
                <RequestHeader r={r} />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => handle(r, true)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600 transition disabled:opacity-50"
                  >
                    {busyId === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Approve & deactivate
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => handle(r, false)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50 transition disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    Decline
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Resolved — record */}
      {resolved.length > 0 && (
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            History ({resolved.length})
          </h2>
          <Card className="divide-y divide-border">
            {resolved.map((r) => (
              <div key={r.id} className="p-4">
                <RequestHeader r={r} showResolved />
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function RequestHeader({
  r,
  showResolved = false,
}: {
  r: AccountDeletionRequestItem;
  showResolved?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-10 w-10 shrink-0">
        {r.requester_avatar && <AvatarImage src={r.requester_avatar} />}
        <AvatarFallback className="text-xs">
          {initials(r.requester_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {r.requester_name}
          </span>
          <StatusBadge status={r.status} />
        </div>
        {r.requester_email && (
          <p className="text-xs text-muted-foreground truncate">
            {r.requester_email}
          </p>
        )}
        <p className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap break-words">
          &ldquo;{r.reason}&rdquo;
        </p>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          Requested {formatRelativeTime(r.created_at)}
          {showResolved && r.resolved_at && (
            <>
              {" · "}
              {r.status} {formatRelativeTime(r.resolved_at)}
              {r.resolver_name && ` by ${r.resolver_name}`}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "border-amber-500/40 text-amber-400 bg-amber-500/10",
    approved: "border-red-500/40 text-red-400 bg-red-500/10",
    rejected: "border-border text-muted-foreground",
    cancelled: "border-border text-muted-foreground",
  };
  const label =
    status === "approved"
      ? "Deactivated"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge
      variant="outline"
      className={`shrink-0 text-[10px] px-1.5 ${map[status] ?? map.rejected}`}
    >
      {label}
    </Badge>
  );
}
