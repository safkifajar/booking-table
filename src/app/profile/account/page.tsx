import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  GraduationCap,
  Ruler,
  Sparkles,
  Quote,
  Heart,
  Pencil,
  Phone,
  User,
  Mail,
} from "lucide-react";
import { InstagramIcon } from "@/components/ui/brand-icons";
import { SohoGlow } from "@/components/ui/soho-glow";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth-v2/current";
import { getHobbyGroups } from "@/lib/hobby-actions";
import { Button } from "@/components/ui/button";
import { ProfilePhotoCarousel } from "../ProfilePhotoCarousel";
import { educationLabel } from "@/lib/education";
import { religionLabel } from "@/lib/religion";

/**
 * Tampilan profil "Account" ala CMB (tema gelap SOHO) — menampilkan SEMUA data
 * onboarding: foto carousel, identitas (nama+umur+lokasi+education+IG), bio,
 * prompts (kartu), looking-for, more-about-me (religion/height/music), interests.
 *
 * Tombol pensil → /profile/account/edit (form edit). Back → /profile.
 * Data dari getCurrentProfile() (lengkap).
 */
export default async function ProfileAccountPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/auth?next=/profile/account");
  }
  if (!profile.onboarded) redirect("/onboarding");

  const [user, hobbyGroups] = await Promise.all([
    getCurrentUser(),
    getHobbyGroups(),
  ]);
  // Map nama minat → emoji (dari master DB) untuk chip Interests.
  const emojiByName = new Map<string, string>();
  for (const g of hobbyGroups)
    for (const it of g.items) if (it.emoji) emojiByName.set(it.name, it.emoji);

  const age = ageFromISO(profile.birthDate);
  const education = educationLabel(profile.education);
  const religion = religionLabel(profile.religion);
  const gender = genderLabel(profile.gender);
  const interested = interestedLabel(profile.interestedIn);
  const igHandle = profile.socialLink?.replace(/^@/, "").trim();
  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  // "More about me" — detail yg terisi. Field yg disembunyikan dari form edit
  // (looking-for, music, food, drink) TIDAK ditampilkan.
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
  if (profile.heightCm)
    moreAboutMe.push({
      icon: <Ruler className="h-4 w-4" />,
      text: `${profile.heightCm} cm`,
    });

  return (
    <main className="relative flex-1 pb-12">
      <SohoGlow />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/profile" aria-label="Back to Profile">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate">
              Edit Account
            </h1>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/profile/account/edit">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Link>
          </Button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Foto carousel */}
        <ProfilePhotoCarousel
          photos={profile.photos ?? []}
          displayName={profile.displayName}
          fullWidth
        />

        {/* Kartu identitas */}
        <section className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">
              {profile.displayName}
            </h2>
            {age !== null && (
              <span className="text-2xl font-light text-muted-foreground">
                {age} yrs
              </span>
            )}
          </div>

          {profile.username && (
            <div className="mt-0.5 text-sm text-muted-foreground">
              @{profile.username}
            </div>
          )}

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
            {user?.email && (
              <InfoRow icon={<Mail className="h-4 w-4" />} text={user.email} />
            )}
            {profile.phone && (
              <InfoRow icon={<Phone className="h-4 w-4" />} text={profile.phone} />
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

        {/* Prompts (kartu tanya-jawab) */}
        {profile.prompts && profile.prompts.length > 0 && (
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
        {profile.hobbies && profile.hobbies.length > 0 && (
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

        {memberSince && (
          <p className="px-1 text-xs text-muted-foreground">
            Member since {memberSince}
          </p>
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

/** Label gender (value DB → tampilan). */
function genderLabel(v: string | null): string | null {
  if (v === "male") return "Man";
  if (v === "female") return "Woman";
  return null;
}

/** Label "interested in" (value DB → tampilan). */
function interestedLabel(v: string | null): string | null {
  if (v === "male") return "Men";
  if (v === "female") return "Women";
  if (v === "both") return "Everyone";
  return null;
}

/** Umur dari ISO date "YYYY-MM-DD" (null kalau kosong/invalid). */
function ageFromISO(iso: string | null): number | null {
  if (!iso) return null;
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}
