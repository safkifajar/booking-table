"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Loader2, MailOpen, Clock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  cn,
  initials,
  formatRelativeTime,
  getActionErrorMessage,
} from "@/lib/utils";
import { acceptInvite, declineInvite, type MyInviteItem } from "@/lib/actions";

type Tab = "pending" | "history";

/**
 * Undangan meja yang diterima user. Tab Pending (accept/decline) + History
 * (accepted / declined / cancelled — record siapa & kapan). Aksi refresh via
 * router.refresh().
 */
export function InvitesManager({ invites }: { invites: MyInviteItem[] }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("pending");
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const pending = invites.filter((i) => i.status === "pending" && i.can_respond);
  // Semua yang bukan actionable-pending masuk history (accepted/declined/
  // cancelled, + pending yang sudah tak bisa direspon karena booking batal).
  const history = invites.filter(
    (i) => !(i.status === "pending" && i.can_respond)
  );

  async function run(
    key: string,
    fn: () => Promise<unknown>,
    okMsg: string,
    errMsg: string
  ) {
    setBusyId(key);
    try {
      await fn();
      toast.success(okMsg);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, errMsg));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(
          [
            { key: "pending", label: `Pending (${pending.length})` },
            { key: "history", label: `History (${history.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pending" &&
        (pending.length === 0 ? (
          <EmptyState text="No invites waiting for you. When someone invites you to a table (after their booking is paid), it shows up here." />
        ) : (
          <div className="space-y-2">
            {pending.map((i) => (
              <Card key={i.session_id} className="p-3">
                <InviteHeader invite={i} />
                <div className="mt-3 flex gap-1.5">
                  <Button
                    variant="gold"
                    size="sm"
                    className="flex-1"
                    disabled={busyId === i.session_id}
                    onClick={() =>
                      run(
                        i.session_id,
                        () => acceptInvite({ sessionId: i.session_id }),
                        `Joined ${i.inviter_name}'s table`,
                        "Failed to accept invite"
                      )
                    }
                  >
                    {busyId === i.session_id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === i.session_id}
                    onClick={() =>
                      run(
                        i.session_id,
                        () => declineInvite({ sessionId: i.session_id }),
                        "Invite declined",
                        "Failed to decline invite"
                      )
                    }
                  >
                    <X className="h-4 w-4" />
                    Decline
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {tab === "history" &&
        (history.length === 0 ? (
          <EmptyState text="No past invites yet." />
        ) : (
          <Card className="divide-y divide-border">
            {history.map((i) => (
              <div key={i.session_id} className="p-3">
                <InviteHeader invite={i} showResponded />
              </div>
            ))}
          </Card>
        ))}
    </div>
  );
}

/** Baris info undangan: pengundang + meja + waktu + status badge. */
function InviteHeader({
  invite: i,
  showResponded = false,
}: {
  invite: MyInviteItem;
  showResponded?: boolean;
}) {
  // Accepted & sesi masih aktif → link ke sesi; selain itu non-link.
  const linkable =
    i.status === "accepted" &&
    ["open", "locked", "reserved", "overdue"].includes(i.session_status);

  const body = (
    <div className="flex items-start gap-3">
      <Avatar className="h-10 w-10 shrink-0">
        {i.inviter_avatar && <AvatarImage src={i.inviter_avatar} />}
        <AvatarFallback className="text-xs">
          {initials(i.inviter_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{i.inviter_name}</span>{" "}
          <span className="text-muted-foreground">invited you to</span>{" "}
          <span className="font-medium">table {i.table_label}</span>
        </p>
        <p className="text-xs text-muted-foreground truncate">{i.area_name}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {showResponded && i.responded_at
            ? `${statusVerb(i.status)} ${formatRelativeTime(i.responded_at)}`
            : `Invited ${formatRelativeTime(i.invited_at)}`}
        </p>
      </div>
      <StatusBadge status={i.status} />
    </div>
  );

  return linkable ? (
    <Link href={`/session/${i.session_id}`} className="block group">
      {body}
    </Link>
  ) : (
    body
  );
}

function StatusBadge({ status }: { status: MyInviteItem["status"] }) {
  const map: Record<
    MyInviteItem["status"],
    { label: string; cls: string }
  > = {
    pending: {
      label: "Pending",
      cls: "border-amber-500/40 text-amber-400 bg-amber-500/10",
    },
    accepted: {
      label: "Accepted",
      cls: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
    },
    declined: {
      label: "Declined",
      cls: "border-border text-muted-foreground",
    },
    cancelled: {
      label: "Cancelled",
      cls: "border-border text-muted-foreground",
    },
  };
  const s = map[status];
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 text-[10px] px-1.5", s.cls)}
    >
      {s.label}
    </Badge>
  );
}

function statusVerb(status: MyInviteItem["status"]): string {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
    default:
      return "Updated";
  }
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="p-6 text-center border-dashed">
      <MailOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}
