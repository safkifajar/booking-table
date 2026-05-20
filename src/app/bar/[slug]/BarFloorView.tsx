"use client";

import * as React from "react";
import Link from "next/link";
import { FloorMap, type FloorMapTable } from "@/components/floor/FloorMap";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, MapPin, Users, Lock, Sparkles } from "lucide-react";
import { formatIDR, initials } from "@/lib/utils";
import type { Bar, FloorArea } from "@/types/db";

interface Props {
  bar: Bar;
  areasWithTables: Array<{ area: FloorArea; tables: FloorMapTable[] }>;
  userMenu?: React.ReactNode;
}

export function BarFloorView({ bar, areasWithTables, userMenu }: Props) {
  const [activeAreaSlug, setActiveAreaSlug] = React.useState(
    areasWithTables[0]?.area.slug ?? ""
  );
  const [selectedTable, setSelectedTable] = React.useState<FloorMapTable | null>(null);

  const activeArea = areasWithTables.find((a) => a.area.slug === activeAreaSlug);

  return (
    <main className="flex-1 pb-32">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/" aria-label="Back to home">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-primary/70">
              {bar.tagline}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">{bar.name}</h1>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span className="truncate max-w-[200px]">{bar.address}</span>
          </div>
          {userMenu}
        </div>

        {/* Area tabs */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-2 flex gap-2 overflow-x-auto">
          {areasWithTables.map(({ area, tables }) => {
            const openCount = tables.filter((t) => t.active_session?.status === "open").length;
            const active = activeAreaSlug === area.slug;
            return (
              <button
                key={area.id}
                onClick={() => {
                  setActiveAreaSlug(area.slug);
                  setSelectedTable(null);
                }}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition border ${
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
              >
                {area.name}
                {openCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1">
                    {openCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-4">
          <LegendDot color="rgba(28,28,28,0.9)" border="rgba(255,255,255,0.15)" label="Available" />
          <LegendDot color="rgba(201,169,97,0.4)" border="#c9a961" label="Open table" pulse />
          <LegendDot color="rgba(220,38,38,0.15)" border="#dc2626" label="Locked / full" />
        </div>

        {activeArea && (
          <FloorMap
            canvasWidth={activeArea.area.canvas_width}
            canvasHeight={activeArea.area.canvas_height}
            tables={activeArea.tables}
            selectedTableId={selectedTable?.id ?? null}
            onSelectTable={setSelectedTable}
            className="bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a]"
          />
        )}

        {/* Active tables list (for accessibility & on small screens) */}
        {activeArea && (
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeArea.tables
              .filter((t) => t.active_session)
              .map((t) => (
                <Card key={t.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10">
                      {t.active_session?.host_avatar && (
                        <AvatarImage src={t.active_session.host_avatar} />
                      )}
                      <AvatarFallback>
                        {initials(t.active_session?.host_name ?? "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="default" className="text-[10px] px-1.5">
                          {t.label}
                        </Badge>
                        {t.active_session?.status === "locked" && (
                          <Lock className="h-3 w-3 text-red-400" />
                        )}
                      </div>
                      <p className="text-sm font-medium truncate">
                        {t.active_session?.title ?? "Open Table"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Host: {t.active_session?.host_name}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {t.active_session?.member_count}/{t.capacity}
                        </span>
                        {t.active_session?.vibe_tags?.[0] && (
                          <span className="flex items-center gap-1">
                            <Sparkles className="h-3 w-3 text-primary/60" />
                            {t.active_session.vibe_tags[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            {activeArea.tables.filter((t) => t.active_session).length === 0 && (
              <Card className="p-6 col-span-full text-center text-sm text-muted-foreground border-dashed">
                Tidak ada meja yang aktif di area ini. Tap meja kosong di denah untuk mulai
                buka meja sendiri.
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Bottom sheet: selected table */}
      {selectedTable && (
        <TableSheet table={selectedTable} onClose={() => setSelectedTable(null)} />
      )}
    </main>
  );
}

function LegendDot({
  color,
  border,
  label,
  pulse,
}: {
  color: string;
  border: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block w-3 h-3 rounded-full ${pulse ? "animate-pulse" : ""}`}
        style={{ background: color, borderColor: border, borderWidth: 1, borderStyle: "solid" }}
      />
      <span>{label}</span>
    </div>
  );
}

function TableSheet({
  table,
  onClose,
}: {
  table: FloorMapTable;
  onClose: () => void;
}) {
  const session = table.active_session;
  const isAvailable = !session;
  const isOpen = session?.status === "open";

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card shadow-2xl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="default" className="text-xs">
                {table.label}
              </Badge>
              <span className="text-xs text-muted-foreground capitalize">
                {table.shape} · {table.capacity} seats
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-semibold">
              {isAvailable
                ? "Available — be the host"
                : session?.title ?? "Open Table"}
            </h2>
            {session && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Host: {session.host_name} ·{" "}
                <Users className="inline h-3 w-3 -mt-0.5" /> {session.member_count}/{table.capacity}
              </p>
            )}
            {table.min_spend && table.min_spend > 0 && (
              <p className="text-xs text-primary mt-1">
                Min spend: {formatIDR(table.min_spend)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm shrink-0"
            aria-label="Close"
          >
            Tutup
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {isAvailable && (
            <Button variant="gold" size="lg" className="flex-1 min-w-[140px]" asChild>
              <Link href={`/open-table?tableId=${table.id}`}>Open This Table</Link>
            </Button>
          )}
          {isOpen && (
            <Button variant="outline" size="lg" className="flex-1 min-w-[140px]" asChild>
              <Link href={`/session/${session.id}/preview`}>Lihat Meja</Link>
            </Button>
          )}
          {session?.status === "locked" && (
            <Button variant="outline" size="lg" className="flex-1" disabled>
              <Lock className="h-4 w-4" /> Locked
            </Button>
          )}
          <Button variant="ghost" size="lg" onClick={onClose}>
            Tutup
          </Button>
        </div>
        {isOpen && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Meja ini hanya bisa di-join lewat link invite dari host
          </p>
        )}
      </div>
    </div>
  );
}
