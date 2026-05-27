import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { UserMenu } from "@/components/UserMenu";
import {
  LayoutDashboard,
  Receipt,
  Utensils,
  TrendingUp,
  Settings,
  ArrowLeft,
} from "lucide-react";
import { AdminNavLink } from "./AdminNavLink";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const bar = await requireAdmin();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition"
            aria-label="Back to app"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs hidden sm:inline">App</span>
          </Link>
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-primary/70">
                Admin · {bar.role}
              </div>
              <h1 className="text-sm font-semibold truncate leading-tight">
                {bar.name}
              </h1>
            </div>
          </div>
          <div className="flex-1" />
          <UserMenu />
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className="hidden md:flex w-56 border-r border-border bg-card/30 flex-col p-3 gap-1 shrink-0 sticky top-[57px] h-[calc(100vh-57px)]">
          <AdminNavLink href="/admin" icon={<LayoutDashboard className="h-4 w-4" />}>
            Overview
          </AdminNavLink>
          <AdminNavLink
            href="/admin/transactions"
            icon={<Receipt className="h-4 w-4" />}
          >
            Transaksi
          </AdminNavLink>
          <AdminNavLink href="/admin/items" icon={<Utensils className="h-4 w-4" />}>
            Item Performance
          </AdminNavLink>

          <div className="mt-auto pt-4 border-t border-border space-y-1">
            <Link
              href="/staff"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <Settings className="h-3.5 w-3.5" /> Staff Dashboard
            </Link>
          </div>
        </aside>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border flex">
          <AdminNavLink
            href="/admin"
            icon={<LayoutDashboard className="h-4 w-4" />}
            mobile
          >
            Overview
          </AdminNavLink>
          <AdminNavLink
            href="/admin/transactions"
            icon={<Receipt className="h-4 w-4" />}
            mobile
          >
            Transaksi
          </AdminNavLink>
          <AdminNavLink
            href="/admin/items"
            icon={<Utensils className="h-4 w-4" />}
            mobile
          >
            Items
          </AdminNavLink>
        </nav>

        {/* Main */}
        <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
      </div>
    </div>
  );
}
