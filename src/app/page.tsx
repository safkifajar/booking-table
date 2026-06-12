import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UserMenu } from "@/components/UserMenu";
import { StaffShortcut } from "@/components/StaffShortcut";
import { StoryBarSection } from "@/components/story/StoryBarSection";

export default function HomePage() {
  return (
    <main className="flex-1">
      {/* Top bar with user menu */}
      <div className="absolute top-0 inset-x-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-end">
          <UserMenu />
        </div>
      </div>

      {/* Staff shortcut banner (only renders if user has staff_roles) */}
      <div className="pt-16">
        <StaffShortcut />
      </div>

      {/* Story bar — renders only if user logged in */}
      <StoryBarSection />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(201,169,97,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(201,169,97,0.08),transparent_50%)]" />

        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 sm:pt-28 sm:pb-24">
          <div className="flex items-center gap-2 mb-8">
            <div className="h-px w-12 bg-primary/60" />
            <span className="text-xs tracking-[0.3em] uppercase text-primary/80 font-medium">
              SOHO Social House · Purwokerto
            </span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
            <span className="text-foreground">Reserve your night.</span>
            <br />
            <span className="text-gold-gradient">Host the vibe.</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mb-10 leading-relaxed">
            Book a table, invite your circle, share the bill — all in one place.
            See who&apos;s out tonight, join an open table, or host your own.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" variant="gold">
              <Link href="/bar/soho-purwokerto">Browse Tables</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sessions">See What&apos;s Live</Link>
            </Button>
          </div>

          {/* Stats strip */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-2xl">
            <Stat label="Tables" value="24" />
            <Stat label="Areas" value="2" />
            <Stat label="Menu items" value="35+" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-16 sm:py-24">
          <div className="mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">How it works</h2>
            <p className="text-muted-foreground">
              Designed for the way you actually go out.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              step="01"
              title="Pick a table"
              desc="See the live floor plan. Indoor lounge, rooftop, VIP — choose what fits the night."
            />
            <FeatureCard
              step="02"
              title="Open or join"
              desc="Open a table as host, or join a public table that's already running."
            />
            <FeatureCard
              step="03"
              title="Invite your circle"
              desc="Share a link. Friends scan, join, and you can see who's at the table."
            />
            <FeatureCard
              step="04"
              title="Order together"
              desc="Everyone orders from their phone. Cocktails, bites, mains — all on one tab."
            />
            <FeatureCard
              step="05"
              title="Split the bill"
              desc="Equal split, itemized, or pay your own. Transparent — see who paid what."
            />
            <FeatureCard
              step="06"
              title="Settle & go"
              desc="QRIS, e-wallet, card. One tap, one tab closed."
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} SOHO Social House
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/admin" className="hover:text-primary transition">
              Staff Login
            </Link>
            <Link href="/bar/soho-purwokerto" className="hover:text-primary transition">
              Floor Plan
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-bold text-gold-gradient">{value}</div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

function FeatureCard({
  step,
  title,
  desc,
}: {
  step: string;
  title: string;
  desc: string;
}) {
  return (
    <Card className="p-6 hover:border-primary/40 transition-colors group">
      <div className="text-xs font-mono text-primary/60 mb-3">{step}</div>
      <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </Card>
  );
}
