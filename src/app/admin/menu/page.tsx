import { requireAdmin } from "@/lib/admin";
import {
  getAdminMenuCategories,
  getAdminMenuItems,
} from "@/lib/menu-actions";
import { MenuManager } from "./MenuManager";

export default async function AdminMenuPage() {
  const bar = await requireAdmin();
  const [categories, items] = await Promise.all([
    getAdminMenuCategories(bar.id),
    getAdminMenuItems(bar.id),
  ]);

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">
            Menu Management
          </div>
          <h1 className="text-2xl font-semibold">Menu & Kategori</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola menu items dan kategori untuk {bar.name}.
          </p>
        </div>

        <MenuManager
          barId={bar.id}
          initialCategories={categories}
          initialItems={items}
        />
      </div>
    </main>
  );
}
