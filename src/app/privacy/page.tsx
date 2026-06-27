import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getBarBySlug } from "@/lib/queries";
import { getPublicLegalDoc } from "@/lib/legal-actions";
import { MarkdownView } from "@/components/MarkdownView";

export const metadata = { title: "Kebijakan Privasi" };

export default async function PrivacyPage() {
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const bar = await getBarBySlug(barSlug);
  if (!bar) notFound();

  const doc = await getPublicLegalDoc(bar.id, "privacy");

  return (
    <main className="flex-1 pb-16">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Kembali
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mb-1">{doc.title}</h1>
        {doc.updated_at && (
          <p className="text-xs text-muted-foreground mb-5">
            Terakhir diperbarui{" "}
            {new Date(doc.updated_at).toLocaleDateString("id-ID", {
              dateStyle: "long",
            })}
          </p>
        )}
        <MarkdownView content={doc.content} />
      </div>
    </main>
  );
}
