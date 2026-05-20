"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Users, Crown } from "lucide-react";
import { joinByCode } from "@/lib/actions";
import { initials, getActionErrorMessage } from "@/lib/utils";

interface Props {
  code: string;
  invite: { isExpired: boolean; isMaxedOut: boolean };
  session: { id: string; title: string | null; status: string; vibe_tags: string[] };
  table: { label: string; capacity: number; shape: string; areaName: string };
  host: { display_name: string; avatar_url: string | null };
  memberCount: number;
}

export function JoinForm(props: Props) {
  const [loading, setLoading] = React.useState(false);

  const unavailable =
    props.invite.isExpired ||
    props.invite.isMaxedOut ||
    props.session.status !== "open" ||
    props.memberCount >= props.table.capacity;

  const reason = props.invite.isExpired
    ? "Link undangan sudah kedaluwarsa"
    : props.invite.isMaxedOut
      ? "Link undangan sudah mencapai batas pemakaian"
      : props.session.status !== "open"
        ? "Meja sudah ditutup"
        : props.memberCount >= props.table.capacity
          ? "Meja sudah penuh"
          : null;

  async function handleJoin() {
    setLoading(true);
    try {
      await joinByCode({ code: props.code });
      // redirects on success
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal join"));
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-medium">
            Join Table
          </span>
        </div>
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12">
            {props.host.avatar_url && <AvatarImage src={props.host.avatar_url} />}
            <AvatarFallback>{initials(props.host.display_name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-xl leading-tight">
              {props.session.title ?? "Open Table"}
            </CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1.5">
              <Crown className="h-3 w-3 text-primary" />
              Host: {props.host.display_name}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Table info */}
        <div className="rounded-md bg-muted/40 border border-border p-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Meja</span>
            <Badge variant="default">{props.table.label}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Area</span>
            <span>{props.table.areaName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Sudah ada</span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {props.memberCount} / {props.table.capacity}
            </span>
          </div>
        </div>

        {/* Vibe tags */}
        {props.session.vibe_tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {props.session.vibe_tags.map((v) => (
              <Badge key={v} variant="secondary" className="text-xs">
                {v}
              </Badge>
            ))}
          </div>
        )}

        {/* CTA / Reason */}
        {unavailable ? (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
            {reason}
          </div>
        ) : (
          <Button
            variant="gold"
            size="lg"
            className="w-full"
            onClick={handleJoin}
            disabled={loading}
          >
            {loading ? "Bergabung..." : "Join Table"}
          </Button>
        )}

        <Button asChild variant="ghost" size="sm" className="w-full">
          <Link href="/">Lihat meja lain</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
