"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  INTEREST_CATALOG,
  MAX_INTERESTS,
  type InterestGroup,
} from "./interests";

/**
 * Pemilih minat CMB-style ("What do you like?"). Chip pill per kategori,
 * maks {@link MAX_INTERESTS} pilihan, tiap kategori bisa "See more/less"
 * (collapsed ke ~2 baris). Nilai = daftar `name` terpilih (disimpan ke
 * profiles.hobbies).
 */
export function InterestPicker({
  selected,
  onChange,
  max = MAX_INTERESTS,
  catalog = INTEREST_CATALOG,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
  catalog?: InterestGroup[];
}) {
  const atMax = selected.length >= max;
  const selectedSet = new Set(selected);

  function toggle(name: string) {
    if (selectedSet.has(name)) {
      onChange(selected.filter((x) => x !== name));
    } else if (!atMax) {
      onChange([...selected, name]);
    }
  }

  return (
    <div className="space-y-6">
      {catalog.map((group) => (
        <InterestCategory
          key={group.category}
          group={group}
          selectedSet={selectedSet}
          atMax={atMax}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

/** Jumlah chip yg ditampilkan saat kategori collapsed (≈ 2 baris). */
const COLLAPSED_COUNT = 6;

function InterestCategory({
  group,
  selectedSet,
  atMax,
  onToggle,
}: {
  group: InterestGroup;
  selectedSet: Set<string>;
  atMax: boolean;
  onToggle: (name: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const canExpand = group.items.length > COLLAPSED_COUNT;
  const visible = expanded ? group.items : group.items.slice(0, COLLAPSED_COUNT);

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/80 mb-2.5">
        {group.category}
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((item) => {
          const active = selectedSet.has(item.name);
          const disabled = !active && atMax;
          return (
            <button
              key={item.name}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(item.name)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition",
                active
                  ? "bg-primary/15 border-primary/50 text-primary"
                  : disabled
                    ? "border-border text-muted-foreground/40 cursor-not-allowed"
                    : "border-border text-foreground/90 hover:border-foreground/40"
              )}
            >
              <span aria-hidden className="text-base leading-none">
                {item.emoji}
              </span>
              {item.name}
            </button>
          );
        })}
      </div>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
}
