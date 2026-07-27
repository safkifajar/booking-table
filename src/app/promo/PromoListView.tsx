"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Tag, PartyPopper, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicBanner } from "@/lib/banner-actions";

type Tab = "promo" | "event";

/**
 * Daftar Promo & Event dengan 2 tab (Promo / Event). Komponen tab dibuat
 * sama persis dengan tab Floor/Menu di halaman Booking (segmented control
 * di dalam kotak muted).
 */
export function PromoListView({ banners }: { banners: PublicBanner[] }) {
  const promos = banners.filter((b) => b.category === "promo");
  const events = banners.filter((b) => b.category === "event");

  // Tab default: yang ada isinya. Kalau promo kosong tapi event ada → buka event.
  const [tab, setTab] = React.useState<Tab>(
    promos.length === 0 && events.length > 0 ? "event" : "promo"
  );

  const list = tab === "promo" ? promos : events;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
      {/* Tab switcher: Promo vs Event — sama dgn Floor/Menu di Booking */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border w-full mb-4">
        <TabButton
          icon={<Tag className="h-3.5 w-3.5" />}
          label="Promo"
          count={promos.length}
          active={tab === "promo"}
          onClick={() => setTab("promo")}
        />
        <TabButton
          icon={<PartyPopper className="h-3.5 w-3.5" />}
          label="Event"
          count={events.length}
          active={tab === "event"}
          onClick={() => setTab("event")}
        />
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-border bg-gradient-to-b from-card to-primary/[0.04] p-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
            {tab === "promo" ? (
              <Tag className="h-7 w-7 text-primary/70" />
            ) : (
              <PartyPopper className="h-7 w-7 text-primary/70" />
            )}
          </div>
          <p className="text-sm font-medium mb-1">
            No {tab === "promo" ? "promo" : "event"} available
          </p>
          <p className="text-xs text-muted-foreground">
            Check back later for the latest {tab === "promo" ? "promos" : "events"}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {list.map((b) => (
            <PromoCard key={b.id} banner={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
      {count > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted-foreground/20 text-muted-foreground"
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function PromoCard({ banner }: { banner: PublicBanner }) {
  const isEvent = banner.category === "event";
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
    }).format(new Date(iso));
  const periodLabel = banner.startsAt
    ? banner.endsAt
      ? `${fmtDate(banner.startsAt)} – ${fmtDate(banner.endsAt)}`
      : `from ${fmtDate(banner.startsAt)}`
    : banner.endsAt
      ? `until ${fmtDate(banner.endsAt)}`
      : null;

  return (
    <Link
      href={`/promo/${banner.id}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40"
    >
      <div className="relative aspect-[16/9] bg-zinc-900">
        <Image
          src={banner.imageUrl}
          alt={banner.title ?? "Promo"}
          fill
          className="object-cover transition group-hover:scale-[1.02]"
          sizes="(max-width: 640px) 100vw, 320px"
        />
        <span
          className={
            "absolute top-2.5 left-2.5 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm " +
            (isEvent
              ? "bg-sky-500/90 text-white"
              : "bg-primary/90 text-primary-foreground")
          }
        >
          {isEvent ? "Event" : "Promo"}
        </span>
      </div>
      <div className="p-3">
        {banner.title && (
          <h3 className="text-sm font-semibold truncate">{banner.title}</h3>
        )}
        {banner.subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {banner.subtitle}
          </p>
        )}
        {periodLabel && (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <Calendar className="h-3.5 w-3.5" />
            {periodLabel}
          </p>
        )}
      </div>
    </Link>
  );
}
