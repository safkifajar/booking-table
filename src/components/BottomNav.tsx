"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, Camera, Map, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Bar ID untuk story upload — kalau null, tombol center disabled */
  barId?: string;
  /** True kalau user belum login — center button redirect ke /auth */
  isAnon?: boolean;
  /** Slot untuk component yang trigger story uploader (handed dari parent
   *  yang mount StoryUploader modal). Kalau provided, tombol center fire
   *  callback ini bukannya redirect ke /story. */
  onUploadStory?: () => void;
}

/**
 * Sticky bottom navigation (mobile-first).
 *
 * 5 tabs:
 * - Home (/)
 * - Booking (/booking — future reservation page)
 * - Story Camera (center, prominent — upload story)
 * - Map (/bar/[slug] — floor plan)
 * - Profile (/profile)
 *
 * Tampil di mobile & desktop (di desktop tetap di bawah, lebar dibatasi
 * max-w-md di tengah).
 */
export function BottomNav({ barId, isAnon, onUploadStory }: Props) {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur-md"
      aria-label="Bottom navigation"
    >
      <div className="max-w-md mx-auto px-2 grid grid-cols-5 items-stretch h-16">
        <NavItem href="/" icon={<Home />} label="Home" active={isActive("/")} />
        <NavItem
          href="/booking"
          icon={<Calendar />}
          label="Booking"
          active={isActive("/booking")}
        />

        {/* Center: Story camera — prominent */}
        <CenterCameraButton
          disabled={!barId || !!isAnon}
          isAnon={isAnon}
          onClick={onUploadStory}
        />

        <NavItem
          href="/bar/soho-purwokerto"
          icon={<Map />}
          label="Map"
          active={isActive("/bar")}
        />
        <NavItem
          href="/profile"
          icon={<User />}
          label="Profile"
          active={isActive("/profile")}
        />
      </div>
    </nav>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center justify-end gap-1 h-full pb-2 text-[10px] leading-none transition",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span className={cn("h-5 w-5 flex items-center justify-center", active && "scale-110")}>
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

function CenterCameraButton({
  disabled,
  isAnon,
  onClick,
}: {
  disabled: boolean;
  isAnon?: boolean;
  onClick?: () => void;
}) {
  if (isAnon) {
    return (
      <Link
        href="/auth?next=/"
        className="flex flex-col items-center justify-end gap-1 h-full pb-2 leading-none"
        aria-label="Sign in untuk upload story"
      >
        <span className="h-12 w-12 -mt-6 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center shadow-lg shadow-primary/30 ring-2 ring-background">
          <Camera className="h-6 w-6 text-primary-foreground" />
        </span>
        <span className="text-[10px] text-muted-foreground">Story</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center justify-end gap-1 h-full pb-2 leading-none disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Upload story"
    >
      <span className="h-12 w-12 -mt-6 rounded-full bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center shadow-lg shadow-primary/30 ring-2 ring-background transition hover:scale-105 active:scale-95">
        <Camera className="h-6 w-6 text-primary-foreground" />
      </span>
      <span className="text-[10px] text-muted-foreground">Story</span>
    </button>
  );
}
