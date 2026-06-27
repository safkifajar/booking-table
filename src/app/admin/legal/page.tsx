import { requireAdmin } from "@/lib/admin";
import { getLegalDocs } from "@/lib/legal-actions";
import { LegalManager } from "./LegalManager";

export default async function AdminLegalPage() {
  const bar = await requireAdmin();
  const docs = await getLegalDocs(bar.id);

  return (
    <main className="flex-1 pb-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">
            Legal
          </div>
          <h1 className="text-2xl font-semibold">Privacy Policy & Term n Condition</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola dokumen legal yang tampil di halaman publik /privacy & /terms.
          </p>
        </div>

        <LegalManager initial={docs} />
      </div>
    </main>
  );
}
