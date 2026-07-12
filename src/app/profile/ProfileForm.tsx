"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Mail,
  Phone,
  Cake,
  FileText,
  Users,
  Heart,
  Link as LinkIcon,
  MapPin,
  GraduationCap,
  Ruler,
  Camera,
  MessageSquareQuote,
  Loader2,
} from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { updateProfile } from "@/lib/actions";
import { getActionErrorMessage, cn } from "@/lib/utils";
import { EDUCATION_OPTIONS } from "@/lib/education";
import { RELIGION_OPTIONS } from "@/lib/religion";
import { PhotoUploader } from "@/app/onboarding/PhotoUploader";
import { PromptPicker } from "@/app/onboarding/PromptPicker";
import { InterestPicker } from "@/app/onboarding/InterestPicker";
import { MAX_PROMPTS } from "@/app/onboarding/prompts";
import type { HobbyGroup } from "@/lib/hobbies";


type Gender = "" | "male" | "female";
type InterestedIn = "" | "male" | "female" | "both";

interface Props {
  email: string;
  initialDisplayName: string;
  initialUsername: string;
  initialPhone: string;
  initialBirthDate: string;
  initialBio: string;
  initialGender: Gender;
  initialInterestedIn: InterestedIn;
  initialSocialLink: string;
  initialArea: string;
  initialLookingFor: string;
  initialEducation: string;
  initialHeightCm: number | null;
  initialReligion: string;
  initialMusicPref: string;
  initialFavFood: string;
  initialFavDrink: string;
  initialHobbies: string[];
  initialPhotos: string[];
  initialPrompts: { prompt: string; answer: string }[];
  /** Master interests dari DB (getHobbyGroups). */
  interestCatalog: HobbyGroup[];
  /** Master pertanyaan prompt dari DB (getPromptTexts). */
  promptOptions: string[];
}

export function ProfileForm({
  email,
  initialDisplayName,
  initialUsername,
  initialPhone,
  initialBirthDate,
  initialBio,
  initialGender,
  initialInterestedIn,
  initialSocialLink,
  initialArea,
  initialLookingFor,
  initialEducation,
  initialHeightCm,
  initialReligion,
  initialMusicPref,
  initialFavFood,
  initialFavDrink,
  initialHobbies,
  initialPhotos,
  initialPrompts,
  interestCatalog,
  promptOptions,
}: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [username, setUsername] = React.useState(initialUsername);
  const [phone, setPhone] = React.useState(initialPhone);
  const [birthDate, setBirthDate] = React.useState(initialBirthDate);
  const [bio, setBio] = React.useState(initialBio);
  const [gender, setGender] = React.useState<Gender>(initialGender);
  const [interestedIn, setInterestedIn] =
    React.useState<InterestedIn>(initialInterestedIn);
  const [socialLink, setSocialLink] = React.useState(initialSocialLink);
  const [area, setArea] = React.useState(initialArea);
  const [education, setEducation] = React.useState(initialEducation);
  const [heightCm, setHeightCm] = React.useState(
    initialHeightCm != null ? String(initialHeightCm) : ""
  );
  const [religion, setReligion] = React.useState(initialReligion);
  // Disembunyikan dari form (looking-for, music, food, drink) tapi nilai lama
  // tetap dikirim saat Save supaya tidak terhapus.
  const lookingFor = initialLookingFor;
  const musicPref = initialMusicPref;
  const favFood = initialFavFood;
  const favDrink = initialFavDrink;
  const [hobbies, setHobbies] = React.useState<string[]>(initialHobbies);
  const [photos, setPhotos] = React.useState<string[]>(initialPhotos);
  const [prompts, setPrompts] = React.useState<
    { prompt: string; answer: string }[]
  >(initialPrompts);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (name.length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    setLoading(true);
    try {
      await updateProfile({
        displayName: name,
        username: username.trim().toLowerCase(),
        phone: phone.trim(),
        birthDate: birthDate,
        bio: bio.trim(),
        gender: gender || undefined,
        interestedIn: interestedIn || undefined,
        socialLink: socialLink.trim() || undefined,
        area: area || undefined,
        lookingFor: (lookingFor as "relationship" | "casual" | "friendship" | "") || undefined,
        education:
          (education as
            | "high_school"
            | "diploma"
            | "bachelor"
            | "master"
            | "doctorate"
            | "other"
            | "") || undefined,
        heightCm: heightCm.trim()
          ? Math.min(230, Math.max(120, parseInt(heightCm, 10) || 120))
          : null,
        religion:
          (religion as
            | "islam"
            | "christian"
            | "catholic"
            | "hindu"
            | "buddhist"
            | "confucian"
            | "spiritual"
            | "") || undefined,
        musicPref: musicPref.trim() || undefined,
        favFood: favFood.trim() || undefined,
        favDrink: favDrink.trim() || undefined,
        hobbies,
        prompts,
      });
      toast.success("Profile saved");
      // Balik ke tampilan profil (CMB-style) dengan data terbaru.
      router.push("/profile/account");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
      setLoading(false);
    }
  }

  const bioLength = bio.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pb-24">
      {/* FOTO — PhotoUploader menyimpan langsung ke server (tak nunggu Save). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            Photos
          </CardTitle>
          <CardDescription>
            Up to 3 photos — the first is your main photo. Saved instantly when
            you upload or remove.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhotoUploader photos={photos} onChange={setPhotos} />
        </CardContent>
      </Card>

      {/* PROMPTS — ice-breaker (disimpan saat Save). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4 text-primary" />
            Prompts
          </CardTitle>
          <CardDescription>
            Pick a few and answer them — up to {MAX_PROMPTS}. Great ice-breakers
            for people at SOHO.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PromptPicker
            prompts={prompts}
            onChange={setPrompts}
            options={promptOptions}
            max={MAX_PROMPTS}
          />
        </CardContent>
      </Card>

      {/* IDENTITAS */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Basic info for your account. Email can&apos;t be changed from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Email (read-only) */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Mail className="h-3 w-3" /> Email
            </label>
            <input
              type="email"
              value={email}
              readOnly
              disabled
              className="w-full h-11 px-3 rounded-md bg-muted/40 border border-border text-muted-foreground cursor-not-allowed"
            />
          </div>

          {/* Display name */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Display name *
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
                }
                placeholder="username"
                minLength={3}
                maxLength={20}
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full h-11 pl-8 pr-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Lowercase letters, numbers, and _ only (3-20 chars). Must be unique.
            </p>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Phone className="h-3 w-3" /> WhatsApp number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 081234567890"
              maxLength={20}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Birth date */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Cake className="h-3 w-3" /> Date of birth
            </label>
            <DatePicker
              value={birthDate}
              onChange={setBirthDate}
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>

          {/* Jenis kelamin */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Gender
            </label>
            <Select
              value={gender}
              onChange={(v) => setGender(v as Gender)}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
              ]}
            />
          </div>

          {/* Tertarik pada */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Heart className="h-3 w-3" /> Interested in
            </label>
            <Select
              value={interestedIn}
              onChange={(v) => setInterestedIn(v as InterestedIn)}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
                { value: "both", label: "Both" },
              ]}
            />
          </div>

          {/* Media sosial */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <LinkIcon className="h-3 w-3" /> Social media
            </label>
            <input
              type="text"
              value={socialLink}
              onChange={(e) => setSocialLink(e.target.value)}
              placeholder="@namauser"
              maxLength={200}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Optional — IG, TikTok, linktree, etc.
            </p>
          </div>

          {/* Alamat (ketik bebas) */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <MapPin className="h-3 w-3" /> Address
            </label>
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. North Purwokerto"
              maxLength={120}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Education */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <GraduationCap className="h-3 w-3" /> Education
            </label>
            <Select
              value={education}
              onChange={setEducation}
              options={[
                { value: "", label: "Prefer not to say" },
                ...EDUCATION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                })),
              ]}
            />
          </div>

          {/* Height */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Ruler className="h-3 w-3" /> Height (cm)
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={120}
              max={230}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g. 170"
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Religion */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Religion
            </label>
            <Select
              value={religion}
              onChange={setReligion}
              options={[
                { value: "", label: "Prefer not to say" },
                ...RELIGION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                })),
              ]}
            />
          </div>

          {/* Bio */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> Short bio
              </label>
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  bioLength > 250 ? "text-amber-400" : "text-muted-foreground"
                )}
              >
                {bioLength}/280
              </span>
            </div>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A short story about yourself, max 280 characters"
              maxLength={280}
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition resize-none text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* INTERESTS — katalog onboarding (English + emoji). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Interests
          </CardTitle>
          <CardDescription>
            Pick what you like so people find their crowd at SOHO. Up to 15.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InterestPicker
            selected={hobbies}
            onChange={setHobbies}
            max={15}
            catalog={interestCatalog}
          />
        </CardContent>
      </Card>

      {/* Submit — sticky bawah (ala onboarding), gold pill full-width. */}
      <StickyActionBar>
        <Button
          type="submit"
          variant="gold"
          size="lg"
          className="w-full rounded-full h-14"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save profile"
          )}
        </Button>
      </StickyActionBar>
    </form>
  );
}

