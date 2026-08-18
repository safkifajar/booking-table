import { requireAdmin } from "@/lib/admin";
import {
  getBuiltInDefaults,
  getLinksForAdmin,
  getLinkTreeConfig,
} from "@/lib/link-tree-actions";
import { LinksManager } from "./LinksManager";

export const dynamic = "force-dynamic";

/** URL publik halaman link-tree — utk ditampilkan & dicopy admin. */
function publicLinkUrl(): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  try {
    const url = new URL(base);
    if (!url.hostname.startsWith("link.")) {
      url.hostname = `link.${url.hostname.replace(/^admin\./, "")}`;
    }
    url.pathname = "/";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export default async function AdminLinksPage() {
  const bar = await requireAdmin();
  // Nilai OTOMATIS tautan bawaan — supaya admin tahu tiap tautan menuju ke
  // mana tanpa harus membuka halaman publik untuk memeriksanya.
  const [links, config, defaults] = await Promise.all([
    getLinksForAdmin(bar.id),
    getLinkTreeConfig(bar.id),
    getBuiltInDefaults(bar.id),
  ]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Link Page</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          One public page with all your links, made for the Instagram bio.
          Anyone can open it, no account needed.
        </p>
      </div>

      <LinksManager
        barId={bar.id}
        initialLinks={links}
        initialConfig={config}
        publicUrl={publicLinkUrl()}
        defaults={defaults}
      />
    </div>
  );
}
