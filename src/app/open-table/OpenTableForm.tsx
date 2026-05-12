"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Lock, Globe, UserPlus } from "lucide-react";
import { openTable } from "@/lib/actions";
import { formatIDR } from "@/lib/utils";
import type { TableShape, SessionVisibility } from "@/types/db";

interface Props {
  table: {
    id: string;
    label: string;
    shape: TableShape;
    capacity: number;
    min_spend: number;
  };
  areaName: string;
  barName: string;
  barSlug: string;
}

const VIBE_OPTIONS = ["chill", "networking", "celebrate", "date", "after-work", "loud"];

export function OpenTableForm({ table, areaName, barSlug }: Props) {
  const [title, setTitle] = React.useState("");
  const [visibility, setVisibility] = React.useState<SessionVisibility>("public");
  const [vibes, setVibes] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  function toggleVibe(v: string) {
    setVibes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v].slice(0, 5)
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await openTable({
        tableId: table.id,
        title: title.trim() || undefined,
        visibility,
        vibeTags: vibes,
      });
      // openTable redirects on success
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuka meja");
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/bar/${barSlug}`}
            className="text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-medium">
            Open Table
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Buka meja {table.label}</CardTitle>
            <CardDescription className="mt-1">
              {areaName} · {table.shape} · kapasitas {table.capacity}
              {table.min_spend > 0 && ` · min ${formatIDR(table.min_spend)}`}
            </CardDescription>
          </div>
          <Badge variant="default">{table.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Judul meja <span className="text-muted-foreground font-normal">(opsional)</span>
            </label>
            <input
              type="text"
              placeholder="Friday night vibes"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Bantu orang lain tahu vibe meja kamu.
            </p>
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium mb-2">Siapa yang bisa join?</label>
            <div className="grid grid-cols-3 gap-2">
              <VisibilityOption
                icon={<Globe className="h-4 w-4" />}
                label="Public"
                desc="Siapa saja"
                active={visibility === "public"}
                onClick={() => setVisibility("public")}
              />
              <VisibilityOption
                icon={<UserPlus className="h-4 w-4" />}
                label="Friends"
                desc="Teman saja"
                active={visibility === "friends"}
                onClick={() => setVisibility("friends")}
              />
              <VisibilityOption
                icon={<Lock className="h-4 w-4" />}
                label="Invite"
                desc="Lewat link"
                active={visibility === "invite_only"}
                onClick={() => setVisibility("invite_only")}
              />
            </div>
          </div>

          {/* Vibes */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Vibe <span className="text-muted-foreground font-normal">(maks 5)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {VIBE_OPTIONS.map((v) => {
                const active = vibes.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleVibe(v)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Capacity preview */}
          <div className="rounded-md bg-muted/40 border border-border p-3 flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-primary" />
            <span>
              Sampai {table.capacity} orang bisa duduk di meja ini
            </span>
          </div>

          {/* Submit */}
          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={loading}
          >
            {loading ? "Membuka meja..." : "Buka Meja Sekarang"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VisibilityOption({
  icon,
  label,
  desc,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-3 rounded-md border transition text-center ${
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] opacity-70">{desc}</span>
    </button>
  );
}
