"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Star, Check, ArrowLeft, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { submitRating } from "@/lib/actions";
import { initials, cn, getActionErrorMessage } from "@/lib/utils";
import type { RatableMember } from "@/types/db";

const TAG_OPTIONS = [
  "good vibes",
  "ramah",
  "fun",
  "respectful",
  "good host",
  "great convo",
  "punctual",
  "generous",
];

interface Props {
  sessionId: string;
  sessionTitle: string | null;
  tableLabel: string;
  members: RatableMember[];
}

export function RateForm({ sessionId, sessionTitle, tableLabel, members }: Props) {
  const remaining = members.filter((m) => !m.already_rated);
  const allDone = remaining.length === 0;

  if (members.length === 0) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="max-w-md w-full text-center p-8">
          <Sparkles className="h-10 w-10 mx-auto text-primary/60 mb-3" />
          <h2 className="text-lg font-semibold mb-2">Sesi solo</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Tidak ada anggota lain di meja ini untuk di-rate.
          </p>
          <Button asChild variant="gold" className="w-full">
            <Link href="/">Kembali ke beranda</Link>
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/" aria-label="Skip">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <Badge variant="default" className="text-[10px]">
                {tableLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">Rate teman semeja</span>
            </div>
            <h1 className="text-base sm:text-lg font-semibold">
              {sessionTitle ?? "Open Table"}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/30">
          <CardHeader>
            <CardTitle>Bagaimana vibe-nya malam ini?</CardTitle>
            <CardDescription>
              Berikan rating bintang & tag positif untuk anggota lain. Kamu hanya rate
              sekali per orang, dan rating ditampilkan sebagai agregat di profil mereka.
            </CardDescription>
          </CardHeader>
        </Card>

        {members.map((m) => (
          <MemberRateCard key={m.member_id} sessionId={sessionId} member={m} />
        ))}

        {allDone ? (
          <Card className="p-6 text-center border-primary/30">
            <Check className="h-8 w-8 mx-auto text-primary mb-2" />
            <p className="text-sm font-medium mb-3">Semua rating sudah kamu kasih</p>
            <Button asChild variant="gold" className="w-full">
              <Link href="/">Selesai</Link>
            </Button>
          </Card>
        ) : (
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Lewati sisanya</Link>
          </Button>
        )}
      </div>
    </main>
  );
}

function MemberRateCard({
  sessionId,
  member,
}: {
  sessionId: string;
  member: RatableMember;
}) {
  const [stars, setStars] = React.useState(0);
  const [hoverStars, setHoverStars] = React.useState(0);
  const [tags, setTags] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(member.already_rated);

  function toggleTag(t: string) {
    setTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t].slice(0, 5)
    );
  }

  async function handleSubmit() {
    if (stars === 0) {
      toast.error("Pilih bintang dulu");
      return;
    }
    setLoading(true);
    try {
      await submitRating({
        sessionId,
        rateeId: member.profile_id,
        stars,
        tags,
      });
      setSubmitted(true);
      toast.success(`Rating untuk ${member.display_name} terkirim`);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal kirim rating"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className={cn(
        "p-5 transition-all",
        submitted && "opacity-60 border-primary/40 bg-primary/5"
      )}
    >
      <div className="flex items-start gap-3 mb-4">
        <Avatar className="h-12 w-12">
          {member.avatar_url && <AvatarImage src={member.avatar_url} />}
          <AvatarFallback>{initials(member.display_name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">{member.display_name}</h3>
          {submitted && (
            <p className="text-xs text-primary flex items-center gap-1">
              <Check className="h-3 w-3" /> Rating terkirim
            </p>
          )}
        </div>
      </div>

      {!submitted && (
        <>
          {/* Stars */}
          <div className="flex items-center justify-center gap-2 mb-4">
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = n <= (hoverStars || stars);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setStars(n)}
                  onMouseEnter={() => setHoverStars(n)}
                  onMouseLeave={() => setHoverStars(0)}
                  className="transition-transform hover:scale-110 active:scale-95"
                  aria-label={`${n} bintang`}
                >
                  <Star
                    className={cn(
                      "h-9 w-9 transition-colors",
                      filled
                        ? "fill-primary text-primary"
                        : "text-muted-foreground/40"
                    )}
                  />
                </button>
              );
            })}
          </div>

          {/* Tags */}
          <div className="mb-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Tag positif <span className="font-normal lowercase">(opsional, maks 5)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TAG_OPTIONS.map((t) => {
                const active = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition",
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            variant="gold"
            size="lg"
            className="w-full"
            disabled={loading || stars === 0}
            onClick={handleSubmit}
          >
            {loading ? "Mengirim..." : "Kirim Rating"}
          </Button>
        </>
      )}
    </Card>
  );
}
