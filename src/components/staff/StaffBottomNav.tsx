"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { StaffTabItem } from "@/components/staff/StaffTabs";

/**
 * Bottom navigation (state-based) untuk dashboard staff (kasir & waiter).
 * Beda dari BottomNav customer yg route-based — ini switch tab di halaman
 * yang sama via onChange(key). Tiap item: icon + label + badge angka + titik
 * alert opsional. Item aktif = warna primary.
 */
export function StaffBottomNav({
  tabs,
  active,
  onChange,
  topSlot,
}: {
  tabs: StaffTabItem[];
  active: string;
  onChange: (key: string) => void;
  /** Konten opsional DI ATAS baris nav (mis. tombol Open Table) — dirender di
   *  dalam container fixed yg sama supaya nempel tanpa celah. */
  topSlot?: React.ReactNode;
}) {
  // Portal ke document.body → fixed benar-benar viewport-relative, kebal dari
  // ancestor stacking/transform context yg bisa bikin fixed jadi "ngambang".
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    // after:* = backstop solid yg extend 40px ke bawah bottom-0 → kalau ada
    // sliver viewport (device toolbar / scroll), tetap ketutup, tak ada konten
    // yg mengintip di bawah nav.
    <div className="fixed bottom-0 inset-x-0 z-50 bg-background after:absolute after:inset-x-0 after:top-full after:h-10 after:bg-background">
      {topSlot && (
        <div>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3">{topSlot}</div>
        </div>
      )}
      <nav aria-label="Staff navigation">
        <div
          className="max-w-md mx-auto px-1 grid items-stretch h-16"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((t) => (
            <StaffNavItem
              key={t.key}
              icon={t.icon}
              label={t.label}
              badge={t.badge}
              alert={t.alert}
              active={active === t.key}
              onClick={() => onChange(t.key)}
            />
          ))}
        </div>
      </nav>
    </div>,
    document.body
  );
}

function StaffNavItem({
  icon,
  label,
  badge,
  alert,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  alert?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 h-full text-[10px] leading-none transition min-w-0",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "relative h-5 w-5 flex items-center justify-center",
          active && "scale-110"
        )}
      >
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[15px] h-[15px] rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {alert && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}
