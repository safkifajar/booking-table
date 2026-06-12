"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  Utensils,
  ChartBar,
  ChevronDown,
  Settings,
  Image as ImageIcon,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavLeaf {
  type: "leaf";
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  type: "group";
  label: string;
  icon: React.ReactNode;
  children: NavLeaf[];
}

type NavItem = NavLeaf | NavGroup;

const NAV: NavItem[] = [
  {
    type: "group",
    label: "Laporan",
    icon: <ChartBar className="h-4 w-4" />,
    children: [
      {
        type: "leaf",
        href: "/admin",
        label: "Overview",
        icon: <LayoutDashboard className="h-4 w-4" />,
      },
      {
        type: "leaf",
        href: "/admin/transactions",
        label: "Transaksi",
        icon: <Receipt className="h-4 w-4" />,
      },
      {
        type: "leaf",
        href: "/admin/items",
        label: "Item Performance",
        icon: <Utensils className="h-4 w-4" />,
      },
    ],
  },
  {
    type: "group",
    label: "Konten",
    icon: <Settings className="h-4 w-4" />,
    children: [
      {
        type: "leaf",
        href: "/admin/banners",
        label: "Banner Promo",
        icon: <ImageIcon className="h-4 w-4" />,
      },
    ],
  },
  {
    type: "group",
    label: "Pengaturan",
    icon: <Settings className="h-4 w-4" />,
    children: [
      {
        type: "leaf",
        href: "/admin/staff",
        label: "Manage Staff",
        icon: <Users className="h-4 w-4" />,
      },
    ],
  },
];

export function AdminSidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {NAV.map((item) =>
        item.type === "leaf" ? (
          <SidebarLeaf key={item.href} item={item} pathname={pathname} />
        ) : (
          <SidebarGroup key={item.label} group={item} pathname={pathname} />
        )
      )}
    </nav>
  );
}

function SidebarLeaf({
  item,
  pathname,
  nested,
}: {
  item: NavLeaf;
  pathname: string;
  nested?: boolean;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2 rounded-md text-sm transition border",
        nested ? "px-3 py-1.5 text-xs" : "px-3 py-2",
        active
          ? "bg-primary/15 text-primary border-primary/30"
          : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
      )}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}

function SidebarGroup({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  // Group open kalau ada child yang aktif (default open untuk Laporan)
  const hasActiveChild = group.children.some((c) => isActive(pathname, c.href));
  const [open, setOpen] = React.useState<boolean>(hasActiveChild || true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition",
          "text-foreground hover:bg-muted"
        )}
      >
        <span className="text-primary/80">{group.icon}</span>
        <span className="flex-1 text-left font-medium">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="mt-1 ml-3 pl-3 border-l border-border space-y-0.5">
          {group.children.map((child) => (
            <SidebarLeaf
              key={child.href}
              item={child}
              pathname={pathname}
              nested
            />
          ))}
        </div>
      )}
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Mobile bottom nav — flat tabs (sub-pages dari "Laporan").
 * Untuk mobile kita skip group concept karena ruangnya terbatas.
 */
export function AdminMobileNav() {
  const pathname = usePathname();
  const items: NavLeaf[] = [
    {
      type: "leaf",
      href: "/admin",
      label: "Overview",
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      type: "leaf",
      href: "/admin/transactions",
      label: "Transaksi",
      icon: <Receipt className="h-4 w-4" />,
    },
    {
      type: "leaf",
      href: "/admin/items",
      label: "Items",
      icon: <Utensils className="h-4 w-4" />,
    },
  ];

  return (
    <>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}
