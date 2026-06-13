import { requireAdmin } from "@/lib/admin";
import { getBarSettings } from "@/lib/settings-actions";
import { SettingsManager } from "./SettingsManager";

export default async function AdminSettingsPage() {
  const bar = await requireAdmin();
  const settings = await getBarSettings(bar.id);

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">
            Pengaturan
          </div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Atur jam operasional dan konfigurasi reservasi untuk {bar.name}.
          </p>
        </div>

        <SettingsManager barId={bar.id} initial={settings} />
      </div>
    </main>
  );
}
