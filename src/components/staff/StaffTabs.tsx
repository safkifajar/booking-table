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
        "flex-1 min-w-0 flex gap-1 p-1 rounded-lg bg-muted/40 border border-border overflow-x-auto",
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
        "relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition shrink-0",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {/* Layar kecil: tab non-aktif icon-only; tab aktif tetap tampil label. */}
      <span className={cn(active ? "inline" : "hidden sm:inline")}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {badge}
        </span>
      )}
      {alert && (
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
      )}
    </button>
  );
}
