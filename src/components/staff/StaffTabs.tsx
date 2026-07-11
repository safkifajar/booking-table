"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tab strip bersama untuk dashboard staff (waiter & kasir) — tampilan konsisten.
 *
 * - Scroll horizontal di layar kecil; label tab non-aktif disembunyikan (icon
 *   only) supaya banyak tab tetap muat.
 * - Tab aktif: aksen merah (primary). Badge angka + titik alert opsional.
 */

export interface StaffTabItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  /** Titik pulse (mis. ada order/ request menunggu). */
  alert?: boolean;
}

export function StaffTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: StaffTabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex-1 min-w-0 flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border",
        className
      )}
    >
      {tabs.map((t) => (
        <StaffTabButton
          key={t.key}
          icon={t.icon}
          label={t.label}
          active={active === t.key}
          onClick={() => onChange(t.key)}
          badge={t.badge}
          alert={t.alert}
        />
      ))}
    </div>
  );
}

function StaffTabButton({
  icon,
  label,
  active,
  onClick,
  badge,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        // Tiap tab flex-1 → bagi rata seluruh lebar (tak ada space kosong).
        "relative flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 px-2 rounded-md text-xs font-medium transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      )}
    >
      <span className="shrink-0">{icon}</span>
      {/* Layar kecil: tab non-aktif icon-only; tab aktif tetap tampil label. */}
      <span className={cn("truncate", active ? "inline" : "hidden sm:inline")}>
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground hidden sm:inline-flex"
          )}
        >
          {badge}
        </span>
      )}
      {alert && (
        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
      )}
    </button>
  );
}
