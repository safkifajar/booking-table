import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  ChevronRight,
  GraduationCap,
  Ruler,
  Sparkles,
  Quote,
  Heart,
  User,
  Globe,
  Lock,
} from "lucide-react";
import { educationLabel } from "@/lib/education";
import { religionLabel } from "@/lib/religion";
import { Button } from "@/components/ui/button";
import { RatingStars } from "@/components/network/RatingStars";
import { TableHistoryList } from "@/components/network/TableHistoryList";
import { ProfilePhotoCarousel } from "@/app/profile/ProfilePhotoCarousel";
import { InstagramIcon } from "@/components/ui/brand-icons";
import { SohoGlow } from "@/components/ui/soho-glow";
import { getCurrentProfile } from "@/lib/auth-v2/current";
import { getHobbyGroups } from "@/lib/hobby-actions";
import {
  getPublicProfile,
  getUserTableHistory,
  getMyActiveSessionIds,
} from "@/lib/queries";
import type { SessionVisibility } from "@/types/db";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ userId: string }>;
}

function visibilityLabel(v: SessionVisibility): string {
  if (v === "public") return "Public";
  if (v === "friends") return "Friends";
  return "Invite only";
}

function ageFrom(iso: string): number {
  const b = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function genderLabel(v: string | null): string | null {
  if (v === "male") return "Man";
  if (v === "female") return "Woman";
  return null;
}
function interestedLabel(v: string | null): string | null {
  if (v === "male") return "Men";
  if (v === "female") return "Women";
  if (v === "both") return "Everyone";
  return null;
}

export default async function NetworkProfilePage({ params }: PageProps) {
  const { userId } = await params;
  const me = await getCurrentProfile();
  const profile = await getPublicProfile(userId, {
    viewerId: me?.id ?? null,
  });
  if (!profile) notFound();

  const isMe = me?.id === profile.id;
  const active = profile.active_session;
  // Akun privat & bukan kita → tampilkan banner + kartu terkunci (blur).
  const locked = profile.is_private && !isMe;

  const [history, myActiveSessionIds, hobbyGroups] = await Promise.all([
    getUserTableHistory(profile.id, 20),
    me ? getMyActiveSessionIds(me.id) : Promise.resolve([]),
    getHobbyGroups(),
  ]);
  const alreadySemeja =
    !!active && myActiveSessionIds.includes(active.session_id);

  // Map nama minat → emoji (dari master DB) untuk chip Interests.
  const emojiByName = new Map<string, string>();
  for (const g of hobbyGroups)
    for (const it of g.items) if (it.emoji) emojiByName.set(it.name, it.emoji);

  const age = profile.birth_date ? ageFrom(profile.birth_date) : null;
  const education = educationLabel(profile.education);
  const religion = religionLabel(profile.religion);
  const gender = genderLabel(profile.gender);
  const interested = interestedLabel(profile.interested_in);
  const igHandle = profile.social_link?.replace(/^@/, "").trim();

  // "More about me" — detail yg terisi.
  const moreAboutMe: { icon: React.ReactNode; text: string }[] = [];
  if (gender)
    moreAboutMe.push({ icon: <User className="h-4 w-4" />, text: gender });
  if (interested)
    moreAboutMe.push({
      icon: <Heart className="h-4 w-4" />,
      text: `Interested in ${interested}`,
    });
  if (religion)
    moreAboutMe.push({ icon: <Sparkles className="h-4 w-4" />, text: religion });
  if (profile.height_cm)
    moreAboutMe.push({
      icon: <Ruler className="h-4 w-4" />,
      text: `${profile.height_cm} cm`,
    });

  return (
    <main className="relative flex-1 pb-24">
      <SohoGlow />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/network" aria-label="Back to Discover">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {profile.display_name}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Foto carousel */}
        <ProfilePhotoCarousel
          photos={profile.photos}
          displayName={profile.display_name}
          fullWidth
        />

        {/* Kartu identitas */}
        <section className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">
              {profile.display_name}
            </h2>
            {age !== null && (
              <span className="text-2xl font-light text-muted-foreground">
                {age} yrs
              </span>
            )}
            {isMe && (
              <span className="text-xs font-normal text-muted-foreground">
                (you)
              </span>
            )}
          </div>

          {profile.username && (
            <div className="mt-0.5 text-sm text-muted-foreground">
              @{profile.username}
            </div>
          )}

          <div className="mt-1.5">
            <RatingStars rating={profile.rating} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {profile.visit_count > 0
              ? `${profile.visit_count}× hung out at SOHO`
              : "Never hung out yet"}
          </p>

          <div className="mt-3 space-y-2 text-sm">
            {profile.area && (
              <InfoRow icon={<MapPin className="h-4 w-4" />} text={profile.area} />
            )}
            {education && (
              <InfoRow
                icon={<GraduationCap className="h-4 w-4" />}
                text={education}
              />
            )}
            {igHandle && (
              <a
                href={`https://instagram.com/${igHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 text-primary hover:underline min-w-0"
              >
                <span className="text-muted-foreground/80 shrink-0">
                  <InstagramIcon className="h-4 w-4" />
                </span>
                <span className="truncate">@{igHandle}</span>
              </a>
            )}
          </div>

          {profile.bio && (
            <p className="mt-4 pt-4 border-t border-border text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
              {profile.bio}
            </p>
          )}
        </section>

        {/* Akun privat — banner + kartu terkunci (blur + ikon kunci) ala IG.
            Data privat sudah di-null-kan di getPublicProfile, jadi section lain
            (bio, prompts, interests, more-about-me, history) otomatis kosong. */}
        {locked && (
          <>
            <section className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 border border-primary/30 text-primary mb-3">
                <Lock className="h-5 w-5" />
              </span>
              <h3 className="text-base font-semibold">This account is private</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Only their basic info is visible. Bio, interests, socials, and
                hangout history are hidden.
              </p>
            </section>

            {/* Preview terkunci: konten diblur + overlay kunci (decorative). */}
            <section className="relative overflow-hidden rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5">
              <div
                aria-hidden
                className="space-y-3 blur-sm select-none pointer-events-none"
              >
                <div className="h-4 w-1/3 rounded bg-muted-foreground/30" />
                <div className="h-3 w-full rounded bg-muted-foreground/20" />
                <div className="h-3 w-5/6 rounded bg-muted-foreground/20" />
                <div className="flex gap-2 pt-1">
                  <span className="h-8 w-20 rounded-full bg-muted-foreground/20" />
                  <span className="h-8 w-24 rounded-full bg-muted-foreground/20" />
                  <span className="h-8 w-16 rounded-full bg-muted-foreground/20" />
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                  <Lock className="h-3.5 w-3.5" />
                  Hidden
                </span>
              </div>
            </section>
          </>
        )}

        {/* Lagi di meja (kalau ada) — network-only */}
        {active && (
          <Link
            href={`/session/${active.session_id}?from=${encodeURIComponent(`/network/${profile.id}`)}`}
            className="block rounded-2xl border border-primary/30 bg-primary/5 p-4 transition hover:bg-primary/10"
          >
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              <span className="flex-1">
                At table{" "}
                <span className="font-semibold">{active.table_label}</span> ·{" "}
                {visibilityLabel(active.visibility)}
              </span>
              {!isMe && alreadySemeja ? (
                <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
                  Same table
                </span>
              ) : (
                !isMe &&
                active.visibility === "public" && (
                  <span className="shrink-0 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                    Join
                  </span>
                )
              )}
              <ChevronRight className="h-4 w-4 text-primary/70 shrink-0" />
            </div>
          </Link>
        )}

        {/* Prompts (kartu tanya-jawab) */}
        {profile.prompts.length > 0 && (
          <div className="space-y-4">
            {profile.prompts.map((p, i) => (
              <section
                key={i}
                className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5"
              >
                <h3 className="text-base font-semibold">{p.prompt}</h3>
                <div className="mt-3 flex gap-2.5 rounded-xl bg-primary/10 p-4">
                  <Quote className="h-4 w-4 shrink-0 text-primary/60" />
                  <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                    {p.answer}
                  </p>
                </div>
              </section>
            ))}
          </div>
        )}

        {/* More about me */}
        {moreAboutMe.length > 0 && (
          <section className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5">
            <h3 className="text-base font-semibold mb-3">More about me</h3>
            <div className="space-y-2.5 text-sm">
              {moreAboutMe.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 text-foreground/90"
                >
                  <span className="text-muted-foreground/80">{row.icon}</span>
                  {row.text}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Interests (chip + emoji) */}
        {profile.hobbies.length > 0 && (
          <section className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5">
            <h3 className="text-base font-semibold mb-3">Interests</h3>
            <div className="flex flex-wrap gap-2">
              {profile.hobbies.map((h) => {
                const emoji = emojiByName.get(h);
                return (
                  <span
                    key={h}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3.5 py-2 text-sm font-medium"
                  >
                    {emoji && (
                      <span aria-hidden className="text-base leading-none">
                        {emoji}
                      </span>
                    )}
                    {h}
                  </span>
                );
              })}
            </div>
          </section>
        )}

        {/* Rating tags — network-only */}
        {profile.rating.top_tags && profile.rating.top_tags.length > 0 && (
          <section className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5">
            <h3 className="text-base font-semibold mb-3 inline-flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary/70" />
              What hangout buddies say
            </h3>
            <div className="flex flex-wrap gap-2">
              {profile.rating.top_tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm"
                >
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Riwayat meja — network-only, hormati privasi */}
        {!profile.hide_history && (
          <section className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5">
            <h3 className="text-base font-semibold mb-3">Hangout history</h3>
            <TableHistoryList entries={history} />
          </section>
        )}
      </div>
    </main>
  );
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-foreground/90">
      <span className="text-muted-foreground/80 shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}
