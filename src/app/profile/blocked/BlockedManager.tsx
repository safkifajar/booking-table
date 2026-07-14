"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ConfirmDialog";
import { initials, getActionErrorMessage } from "@/lib/utils";
import { unblockUser, type FriendListEntry } from "@/lib/friend-actions";

export function BlockedManager({ blocked }: { blocked: FriendListEntry[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function handleUnblock(b: FriendListEntry) {
    const ok = await confirm({
      title: `Unblock ${b.display_name}?`,
      description:
        "They will be able to see your profile and send you a friend request again.",
      confirmText: "Unblock",
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      await unblockUser({ userId: b.id });
      toast.success(`${b.display_name} unblocked`);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to unblock"));
    } finally {
      setBusyId(null);
    }
  }

  if (blocked.length === 0) {
    return (
      <Card className="p-6 text-center border-dashed">
        <Ban className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          You haven&apos;t blocked anyone.
        </p>
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-border">
      {blocked.map((b) => (
        <div key={b.id} className="flex items-center gap-3 p-3">
          {/* Sengaja BUKAN link ke profil — profil orang yang diblokir memang
              tak bisa dibuka (saling 404). */}
          <Avatar className="h-10 w-10 shrink-0 grayscale">
            {b.avatar_url && <AvatarImage src={b.avatar_url} />}
            <AvatarFallback className="text-xs">
              {initials(b.display_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{b.display_name}</p>
            {b.username && (
              <p className="text-xs text-muted-foreground truncate">
                @{b.username}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busyId === b.id}
            onClick={() => handleUnblock(b)}
            className="shrink-0"
          >
            {busyId === b.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Unblock"
            )}
          </Button>
        </div>
      ))}
    </Card>
  );
}
