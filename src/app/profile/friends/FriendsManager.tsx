"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, UserMinus, Check, X, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn, initials, getActionErrorMessage } from "@/lib/utils";
import {
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  unfriend,
  type FriendListEntry,
  type FriendRequestEntry,
} from "@/lib/friend-actions";

type Tab = "friends" | "requests";

/**
 * Daftar teman + request (masuk/keluar). Aksi: unfriend, accept/decline,
 * cancel. Semua aksi optimistic-refresh via router.refresh().
 */
export function FriendsManager({
  friends,
  incoming,
  outgoing,
  initialTab,
}: {
  friends: FriendListEntry[];
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
  initialTab: Tab;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const [busyId, setBusyId] = React.useState<string | null>(null);

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

  async function handleUnfriend(f: FriendListEntry) {
    const ok = await confirm({
      title: `Remove ${f.display_name} from friends?`,
      description: "You can send them a friend request again later.",
      confirmText: "Unfriend",
      variant: "danger",
    });
    if (!ok) return;
    await run(
      f.id,
      () => unfriend({ userId: f.id }),
      `${f.display_name} removed from friends`,
      "Failed to unfriend"
    );
  }

  const requestCount = incoming.length + outgoing.length;

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(
          [
            { key: "friends", label: `Friends (${friends.length})` },
            { key: "requests", label: `Requests (${requestCount})` },
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

      {tab === "friends" &&
        (friends.length === 0 ? (
          <EmptyState text="No friends yet. Find people in the Network tab and send a request." />
        ) : (
          <Card className="divide-y divide-border">
            {friends.map((f) => (
              <div key={f.id} className="flex items-center gap-3 p-3">
                <PersonLink id={f.id} name={f.display_name} avatar={f.avatar_url} username={f.username} />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === f.id}
                  onClick={() => handleUnfriend(f)}
                  className="text-red-400 shrink-0"
                >
                  {busyId === f.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserMinus className="h-4 w-4" />
                  )}
                  Unfriend
                </Button>
              </div>
            ))}
          </Card>
        ))}

      {tab === "requests" && (
        <div className="space-y-5">
          {/* Masuk */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Incoming ({incoming.length})
            </h3>
            {incoming.length === 0 ? (
              <EmptyState text="No incoming requests." />
            ) : (
              <Card className="divide-y divide-border">
                {incoming.map((r) => (
                  <div key={r.request_id} className="flex items-center gap-3 p-3">
                    <PersonLink id={r.id} name={r.display_name} avatar={r.avatar_url} username={r.username} />
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        variant="gold"
                        size="sm"
                        disabled={busyId === r.request_id}
                        onClick={() =>
                          run(
                            r.request_id,
                            () => acceptFriendRequest({ requestId: r.request_id }),
                            `You are now friends with ${r.display_name}`,
                            "Failed to accept request"
                          )
                        }
                      >
                        {busyId === r.request_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Accept
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === r.request_id}
                        onClick={() =>
                          run(
                            r.request_id,
                            () => declineFriendRequest({ requestId: r.request_id }),
                            "Request declined",
                            "Failed to decline request"
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>

          {/* Keluar */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Sent ({outgoing.length})
            </h3>
            {outgoing.length === 0 ? (
              <EmptyState text="No sent requests." />
            ) : (
              <Card className="divide-y divide-border">
                {outgoing.map((r) => (
                  <div key={r.request_id} className="flex items-center gap-3 p-3">
                    <PersonLink id={r.id} name={r.display_name} avatar={r.avatar_url} username={r.username} />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === r.request_id}
                      onClick={() =>
                        run(
                          r.request_id,
                          () => cancelFriendRequest({ requestId: r.request_id }),
                          "Request cancelled",
                          "Failed to cancel request"
                        )
                      }
                      className="shrink-0"
                    >
                      {busyId === r.request_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Cancel"
                      )}
                    </Button>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PersonLink({
  id,
  name,
  avatar,
  username,
}: {
  id: string;
  name: string;
  avatar: string | null;
  username: string | null;
}) {
  return (
    <Link href={`/network/${id}`} className="flex items-center gap-3 flex-1 min-w-0 group">
      <Avatar className="h-10 w-10 shrink-0">
        {avatar && <AvatarImage src={avatar} />}
        <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate group-hover:text-primary transition">
          {name}
        </p>
        {username && (
          <p className="text-xs text-muted-foreground truncate">@{username}</p>
        )}
      </div>
    </Link>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="p-6 text-center border-dashed">
      <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}
