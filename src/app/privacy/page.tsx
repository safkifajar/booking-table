import { notFound } from "next/navigation";
import { getBarBySlug } from "@/lib/queries";
import { getPublicLegalDoc } from "@/lib/legal-actions";
import { MarkdownView } from "@/components/MarkdownView";
import { ProfileSubpageHeader } from "../profile/ProfileSubpageHeader";

export const metadata = { title: "Privacy Policy" };

export default async function PrivacyPage() {
  const barSlug = process.env.NEXT_PUBLIC_BAR_SLUG ?? "soho-purwokerto";
  const bar = await getBarBySlug(barSlug);
  if (!bar) notFound();

  const doc = await getPublicLegalDoc(bar.id, "privacy");

  return (
    <main className="flex-1 pb-16">
      <ProfileSubpageHeader title="Privacy Policy" backHref="/" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-2xl font-bold tracking-tight mb-1">{doc.title}</h1>
        {doc.updated_at && (
          <p className="text-xs text-muted-foreground mb-5">
            Terakhir diperbarui{" "}
            {new Date(doc.updated_at).toLocaleDateString("en-GB", {
              dateStyle: "long",
            })}
          </p>
        )}
        <MarkdownView content={doc.content} />
      </div>
    </main>
  );
}
