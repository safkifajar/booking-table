"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Clock, ArrowRight, UserPlus } from "lucide-react";
import { requestJoinSession } from "@/lib/actions";
import { getActionErrorMessage } from "@/lib/utils";

interface Props {
  sessionId: string;
  barSlug: string;
  hostName: string;
  memberCount: number;
  capacity: number;
  isHost: boolean;
  myStatus: "joined" | "pending" | "left" | "kicked" | null;
  loggedIn: boolean;
}

export function PreviewCTA(props: Props) {
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState(props.myStatus);

  const full = props.memberCount >= props.capacity;

  async function handleRequest() {
    if (!props.loggedIn) return; // shouldn't happen, link goes to auth first
    setLoading(true);
    try {
      const result = await requestJoinSession({ sessionId: props.sessionId });
      setStatus(result.status);
      if (result.status === "pending") {
        toast.success(`Request dikirim ke ${props.hostName}`);
      } else if (result.status === "joined") {
        toast.success("Kamu sudah jadi member meja ini");
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal kirim request"));
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
          <p className="text-sm">Ini meja kamu sendiri.</p>
          <Button asChild variant="gold" className="w-full">
            <Link href={`/session/${props.sessionId}`}>
              Buka session <ArrowRight className="h-4 w-4" />
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
            <p className="font-medium text-sm">Menunggu approval host</p>
            <p className="text-xs text-muted-foreground mt-1">
              Request kamu sudah dikirim ke{" "}
              <span className="text-amber-400">{props.hostName}</span>. Kamu akan
              masuk meja begitu di-approve.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/bar/${props.barSlug}`}>Lihat meja lain dulu</Link>
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
          <p className="text-sm font-medium">Kamu sebelumnya dikeluarkan dari meja ini</p>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/bar/${props.barSlug}`}>Lihat meja lain</Link>
          </Button>
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
            {status === "left" ? "Mau gabung lagi?" : "Mau gabung meja ini?"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Kirim request ke <span className="text-primary">{props.hostName}</span>.
            Kamu masuk setelah host approve.
          </p>
        </div>
        {full && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-300">
            Meja sudah penuh ({props.memberCount}/{props.capacity}). Tunggu kursi
            kosong dulu.
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Button asChild variant="outline" className="flex-1">
            <Link href={`/bar/${props.barSlug}`}>Lihat meja lain</Link>
          </Button>
          {props.loggedIn ? (
            <Button
              variant="gold"
              className="flex-1"
              onClick={handleRequest}
              disabled={loading || full}
            >
              {loading ? "Mengirim..." : "Request Join"}
            </Button>
          ) : (
            <Button asChild variant="gold" className="flex-1">
              <Link
                href={`/auth?next=${encodeURIComponent(`/session/${props.sessionId}/preview`)}`}
              >
                Masuk untuk request
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
