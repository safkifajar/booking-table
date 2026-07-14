"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  UserPlus,
  UserCheck,
  UserMinus,
  Check,
  X,
  Loader2,
  MoreVertical,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { getActionErrorMessage } from "@/lib/utils";
import {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  unfriend,
  blockUser,
  unblockUser,
} from "@/lib/friend-actions";
import type { RelationshipStatus } from "@/lib/friends";

/**
 * Tombol relasi di profil publik (PRD Friends g, k):
 * none -> Add friend · pending_out -> Requested (tap = cancel) ·
 * pending_in -> Accept/Decline · friends -> Friends (tap = unfriend) ·
 * blocked -> Unblock.
 */
export function FriendActions({
  userId,
  displayName,
  status,
  pendingRequestId,
}: {
  userId: string;
  displayName: string;
  status: RelationshipStatus;
  pendingRequestId: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = React.useState(false);

  async function run(fn: () => Promise<unknown>, okMsg: string, errMsg: string) {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, errMsg));
    } finally {
      setBusy(false);
    }
  }

  if (status === "blocked") {
    return (
      <Button
        variant="outline"
        size="lg"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          const ok = await confirm({
            title: `Unblock ${displayName}?`,
            description:
              "They will be able to see your profile and send you a friend request again.",
            confirmText: "Unblock",
          });
          if (!ok) return;
          await run(
            () => unblockUser({ userId }),
            `${displayName} unblocked`,
            "Failed to unblock"
          );
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
        Unblock
      </Button>
    );
  }

  if (status === "friends") {
    return (
      <Button
        variant="outline"
        size="lg"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${displayName} from friends?`,
            description: "You can send them a friend request again later.",
            confirmText: "Unfriend",
            variant: "danger",
          });
          if (!ok) return;
          await run(
            () => unfriend({ userId }),
            `${displayName} removed from friends`,
            "Failed to unfriend"
          );
        }}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UserCheck className="h-4 w-4 text-primary" />
        )}
        Friends
      </Button>
    );
  }

  if (status === "pending_out") {
    return (
      <Button
        variant="outline"
        size="lg"
        className="w-full"
        disabled={busy || !pendingRequestId}
        onClick={async () => {
          if (!pendingRequestId) return;
          const ok = await confirm({
            title: "Cancel friend request?",
            description: `Your request to ${displayName} will be withdrawn.`,
            confirmText: "Cancel request",
            cancelText: "Keep it",
          });
          if (!ok) return;
          await run(
            () => cancelFriendRequest({ requestId: pendingRequestId }),
            "Request cancelled",
            "Failed to cancel request"
          );
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Requested
      </Button>
    );
  }

  if (status === "pending_in") {
    return (
      <div className="flex gap-2">
        <Button
          variant="gold"
          size="lg"
          className="flex-1"
          disabled={busy || !pendingRequestId}
          onClick={() =>
            pendingRequestId &&
            run(
              () => acceptFriendRequest({ requestId: pendingRequestId }),
              `You are now friends with ${displayName}`,
              "Failed to accept request"
            )
          }
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Accept request
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={busy || !pendingRequestId}
          onClick={() =>
            pendingRequestId &&
            run(
              () => declineFriendRequest({ requestId: pendingRequestId }),
              "Request declined",
              "Failed to decline request"
            )
          }
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // none
  return (
    <Button
      variant="gold"
      size="lg"
      className="w-full"
      disabled={busy}
      onClick={() =>
        run(
          () => sendFriendRequest({ targetId: userId }),
          "Friend request sent",
          "Failed to send request"
        )
      }
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
      Add friend
    </Button>
  );
}

/**
 * Menu ⋮ di header profil — Block / Unblock (PRD 7 UI blokir).
 * Pakai <details> native (pola AdminHeaderProfile) biar ringan.
 */
export function ProfileMoreMenu({
  userId,
  displayName,
  isBlockedByMe,
}: {
  userId: string;
  displayName: string;
  isBlockedByMe: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDetailsElement>(null);

  async function handleBlockToggle() {
    ref.current?.removeAttribute("open");
    if (isBlockedByMe) {
      const ok = await confirm({
        title: `Unblock ${displayName}?`,
        description:
          "They will be able to see your profile and send you a friend request again.",
        confirmText: "Unblock",
      });
      if (!ok) return;
      setBusy(true);
      try {
        await unblockUser({ userId });
        toast.success(`${displayName} unblocked`);
        router.refresh();
      } catch (err) {
        toast.error(getActionErrorMessage(err, "Failed to unblock"));
      } finally {
        setBusy(false);
      }
      return;
    }
    const ok = await confirm({
      title: `Block ${displayName}?`,
      description:
        "You won't see each other anywhere in the app. Any friendship and pending requests will be removed. They won't be notified.",
      confirmText: "Block",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await blockUser({ userId });
      toast.success(`${displayName} blocked`);
      // Profil orang yang diblokir tak bisa dibuka lagi → kembali ke Network.
      router.push("/network");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to block"));
      setBusy(false);
    }
  }

  return (
    <details ref={ref} className="relative">
      <summary
        className="list-none cursor-pointer h-9 w-9 rounded-full hover:bg-muted flex items-center justify-center"
        aria-label="More options"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <MoreVertical className="h-5 w-5" />
        )}
      </summary>
      <div className="absolute right-0 z-50 mt-1.5 min-w-40 rounded-lg border border-border bg-card p-1 shadow-2xl">
        <button
          type="button"
          onClick={handleBlockToggle}
          className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left hover:bg-muted text-red-400"
        >
          {isBlockedByMe ? (
            <>
              <Ban className="h-4 w-4" /> Unblock
            </>
          ) : (
            <>
              <UserMinus className="h-4 w-4" /> Block
            </>
          )}
        </button>
      </div>
    </details>
  );
}
