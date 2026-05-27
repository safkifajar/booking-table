"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function AdminNavLink({
  href,
  icon,
  children,
  mobile,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));

  if (mobile) {
    return (
      <Link
        href={href}
        className={cn(
          "flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition",
          active ? "text-primary" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {icon}
        <span>{children}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition",
        active
          ? "bg-primary/15 text-primary border border-primary/30"
          : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
      )}
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
}
