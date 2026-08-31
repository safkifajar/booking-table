"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Lock, Clock, ArrowRight, UserPlus, Users } from "lucide-react";
import { requestJoinSession } from "@/lib/actions";
import { getActionErrorMessage } from "@/lib/utils";

interface Props {
  sessionId: string;
  barSlug: string;
  hostName: string;
  hostId: string;
  memberCount: number;
  capacity: number;
  isHost: boolean;
  myStatus: "joined" | "pending" | "left" | "kicked" | null;
  loggedIn: boolean;
  visibility: string;
  /** Viewer berteman dgn host? Meja "friends" hanya bisa di-join teman (PRD K3). */
  isHostFriend: boolean;
  /** Id penonton — untuk mendengarkan keputusan host secara realtime. */
  viewerId: string | null;
}

export function PreviewCTA(props: Props) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState(props.myStatus);

  // Dengarkan keputusan host (disetujui / ditolak) secara realtime.
  //
  // Halaman ini TIDAK bisa mendengarkan saluran sesi: pemohon belum jadi
  // anggota, jadi ia tak berhak atas saluran itu. Yang didengarkan saluran
  // PENGGUNA — createNotification sudah mengirim sinyal ke sana saat host
  // menyetujui atau menolak. Tanpa ini pemohon harus memuat ulang halaman
  // untuk tahu keputusannya.
  React.useEffect(() => {
    if (!props.viewerId || status !== "pending") return;
    const es = new EventSource(`/api/realtime/user/${props.viewerId}`);
    es.onmessage = () => router.refresh();
    return () => es.close();
  }, [props.viewerId, status, router]);

  const full = props.memberCount >= props.capacity;

  async function handleRequest() {
    if (!props.loggedIn) return; // shouldn't happen, link goes to auth first
    setLoading(true);
    try {
      const result = await requestJoinSession({ sessionId: props.sessionId });
      if (result.status === "error") {
        toast.error(result.error);
        return;
      }
      setStatus(result.status);
      if (result.status === "pending") {
        toast.success(`Request sent to ${props.hostName}`);
      } else if (result.status === "joined") {
        toast.success("You're already a member of this table");
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to send request"));
    } finally {
      setLoading(false);
    }
  }

  // Host viewing own session — redirect to session (sebenarnya sudah handled di page,
  // tapi kalau status berubah jadi pending dst, ini fallback)
  if (props.isHost) {
    return (
      <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/30">
        <CardContent className="p-5 text-center space-y-3">
          <p className="text-sm">This is your own table.</p>
          <Button asChild variant="gold" className="w-full">
            <Link href={`/session/${props.sessionId}`}>
              Open session <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Pending request
  if (status === "pending") {
    return (
      <Card className="bg-gradient-to-br from-amber-500/10 to-transparent border-amber-500/30">
        <CardContent className="p-5 text-center space-y-3">
          <Clock className="h-8 w-8 mx-auto text-amber-400" />
          <div>
            <p className="font-medium text-sm">Waiting for host approval</p>
            <p className="text-xs text-muted-foreground mt-1">
              Your request has been sent to{" "}
              <span className="text-amber-400">{props.hostName}</span>. You&apos;ll
              join the table as soon as it&apos;s approved.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/bar/${props.barSlug}`}>Browse other tables</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Kicked
  if (status === "kicked") {
    return (
      <Card className="bg-gradient-to-br from-red-500/10 to-transparent border-red-500/30">
        <CardContent className="p-5 text-center space-y-3">
          <Lock className="h-8 w-8 mx-auto text-red-400" />
          <p className="text-sm font-medium">You were removed from this table before</p>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/bar/${props.barSlug}`}>Browse other tables</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Meja "friends" + viewer login yg bukan teman host → tak bisa join
  // (PRD K3). Detail tetap terlihat; ajakan: berteman dulu dgn host.
  if (props.visibility === "friends" && props.loggedIn && !props.isHostFriend) {
    return (
      <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/30">
        <CardContent className="p-5 text-center space-y-3">
          <Users className="h-8 w-8 mx-auto text-primary/60" />
          <div>
            <p className="font-medium text-sm">Friends-only table</p>
            <p className="text-xs text-muted-foreground mt-1">
              Only <span className="text-primary">{props.hostName}</span>&apos;s
              friends can join this table. Add them as a friend first.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Button asChild variant="outline" className="flex-1">
              <Link href={`/bar/${props.barSlug}`}>Browse other tables</Link>
            </Button>
            <Button asChild variant="gold" className="flex-1">
              <Link href={`/network/${props.hostId}`}>View host profile</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Default: belum request, atau pernah left
  return (
    <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/30">
      <CardContent className="p-5 text-center space-y-3">
        <UserPlus className="h-8 w-8 mx-auto text-primary/60" />
        <div>
          <p className="font-medium text-sm">
            {status === "left" ? "Want to join again?" : "Want to join this table?"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Send a request to <span className="text-primary">{props.hostName}</span>.
            You&apos;ll join once the host approves.
          </p>
        </div>
        {full && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-300">
            This table is full ({props.memberCount}/{props.capacity}). Wait for a
            seat to open up.
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Button asChild variant="outline" className="flex-1">
            <Link href={`/bar/${props.barSlug}`}>Browse other tables</Link>
          </Button>
          {props.loggedIn ? (
            <Button
              variant="gold"
              className="flex-1"
              onClick={handleRequest}
              disabled={loading || full}
            >
              {loading ? "Sending..." : "Request Join"}
            </Button>
          ) : (
            <Button asChild variant="gold" className="flex-1">
              <Link
                href={`/auth?next=${encodeURIComponent(`/session/${props.sessionId}/preview`)}`}
              >
                Sign in to request
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
