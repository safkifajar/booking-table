"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  X,
  Sparkles,
  Mail,
  Phone,
  Cake,
  FileText,
  Users,
  Heart,
  Link as LinkIcon,
  Lock,
  MapPin,
  Music,
  Utensils,
  Wine,
  GraduationCap,
} from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { updateProfile } from "@/lib/actions";
import { getActionErrorMessage, cn } from "@/lib/utils";
import type { HobbyGroup } from "@/lib/hobbies";
import { EDUCATION_OPTIONS } from "@/lib/education";


type Gender = "" | "male" | "female";
type InterestedIn = "" | "male" | "female" | "both";

const LOOKING_FOR_OPTIONS = [
  { value: "relationship", label: "Relationship" },
  { value: "casual", label: "Casual Date" },
  { value: "friendship", label: "Friendship" },
];

interface Props {
  email: string;
  initialDisplayName: string;
  initialPhone: string;
  initialBirthDate: string;
  initialBio: string;
  initialGender: Gender;
  initialInterestedIn: InterestedIn;
  initialSocialLink: string;
  initialArea: string;
  initialLookingFor: string;
  initialEducation: string;
  initialMusicPref: string;
  initialFavFood: string;
  initialFavDrink: string;
  initialHideHistory: boolean;
  initialHideLocation: boolean;
  initialHideAge: boolean;
  initialHideSocial: boolean;
  initialHobbies: string[];
  hobbyGroups: HobbyGroup[];
}

export function ProfileForm({
  email,
  initialDisplayName,
  initialPhone,
  initialBirthDate,
  initialBio,
  initialGender,
  initialInterestedIn,
  initialSocialLink,
  initialArea,
  initialLookingFor,
  initialEducation,
  initialMusicPref,
  initialFavFood,
  initialFavDrink,
  initialHideHistory,
  initialHideLocation,
  initialHideAge,
  initialHideSocial,
  initialHobbies,
  hobbyGroups,
}: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [phone, setPhone] = React.useState(initialPhone);
  const [birthDate, setBirthDate] = React.useState(initialBirthDate);
  const [bio, setBio] = React.useState(initialBio);
  const [gender, setGender] = React.useState<Gender>(initialGender);
  const [interestedIn, setInterestedIn] =
    React.useState<InterestedIn>(initialInterestedIn);
  const [socialLink, setSocialLink] = React.useState(initialSocialLink);
  const [area, setArea] = React.useState(initialArea);
  const [lookingFor, setLookingFor] = React.useState(initialLookingFor);
  const [education, setEducation] = React.useState(initialEducation);
  const [musicPref, setMusicPref] = React.useState(initialMusicPref);
  const [favFood, setFavFood] = React.useState(initialFavFood);
  const [favDrink, setFavDrink] = React.useState(initialFavDrink);
  const [hideHistory, setHideHistory] = React.useState(initialHideHistory);
  const [hideLocation, setHideLocation] = React.useState(initialHideLocation);
  const [hideAge, setHideAge] = React.useState(initialHideAge);
  const [hideSocial, setHideSocial] = React.useState(initialHideSocial);
  const [hobbies, setHobbies] = React.useState<string[]>(initialHobbies);
  const [loading, setLoading] = React.useState(false);

  function toggleHobby(h: string) {
    const normalized = h.trim().toLowerCase();
    if (!normalized) return;
    setHobbies((prev) =>
      prev.includes(normalized)
        ? prev.filter((x) => x !== normalized)
        : [...prev, normalized].slice(0, 15)
    );
  }

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
        musicPref: musicPref.trim() || undefined,
        favFood: favFood.trim() || undefined,
        favDrink: favDrink.trim() || undefined,
        hideHistory,
        hideLocation,
        hideAge,
        hideSocial,
        hobbies,
      });
      toast.success("Profile saved");
      // Langsung balik ke halaman profil (data terbaru).
      router.push("/profile");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
      setLoading(false);
    }
  }

  // Saran per kategori (dari master list admin), sembunyikan yg sudah dipilih.
  const suggestionGroups = hobbyGroups
    .map((cat) => ({
      label: cat.category,
      items: cat.items.map((i) => i.name).filter((h) => !hobbies.includes(h)),
    }))
    .filter((cat) => cat.items.length > 0);
  const bioLength = bio.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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

          {/* Looking for */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Heart className="h-3 w-3" /> Looking for
            </label>
            <Select
              value={lookingFor}
              onChange={setLookingFor}
              options={[
                { value: "", label: "Prefer not to say" },
                ...LOOKING_FOR_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
              ]}
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

          {/* Music preference */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Music className="h-3 w-3" /> Favorite music
            </label>
            <input
              type="text"
              value={musicPref}
              onChange={(e) => setMusicPref(e.target.value)}
              placeholder="e.g. pop, jazz, hip-hop"
              maxLength={120}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Makanan & minuman favorit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Utensils className="h-3 w-3" /> Favorite food
              </label>
              <input
                type="text"
                value={favFood}
                onChange={(e) => setFavFood(e.target.value)}
                placeholder="e.g. fried rice"
                maxLength={120}
                className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Wine className="h-3 w-3" /> Favorite drink
              </label>
              <input
                type="text"
                value={favDrink}
                onChange={(e) => setFavDrink(e.target.value)}
                placeholder="e.g. coffee, mojito"
                maxLength={120}
                className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
              />
            </div>
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

      {/* HOBI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Hobbies & Interests
          </CardTitle>
          <CardDescription>
            Help your host & tablemates get to know you — easier vibe matching.
            Pick from the available options. Max 15 hobbies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Your hobbies ({hobbies.length})
            </p>
            {hobbies.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                None yet. Pick from the list below.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {hobbies.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => toggleHobby(h)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-primary/15 border border-primary/40 text-primary hover:bg-primary/20 transition"
                  >
                    {h}
                    <X className="h-3 w-3 opacity-70" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {suggestionGroups.length > 0 && (
            <div className="space-y-3">
              {suggestionGroups.map((cat) => (
                <div key={cat.label}>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {cat.label}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.items.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => toggleHobby(h)}
                        disabled={hobbies.length >= 15}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium border transition",
                          "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
                          "disabled:opacity-40 disabled:cursor-not-allowed"
                        )}
                      >
                        + {h}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* PRIVASI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Privacy
          </CardTitle>
          <CardDescription>
            Control what other visitors can see on your profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <PrivacyToggle
            label="Hide visit history"
            desc="List of tables you've joined"
            checked={hideHistory}
            onChange={setHideHistory}
          />
          <PrivacyToggle
            label="Hide current location"
            desc="'At a table' status & appearing in At SOHO now"
            checked={hideLocation}
            onChange={setHideLocation}
          />
          <PrivacyToggle
            label="Hide age"
            desc="Age from date of birth"
            checked={hideAge}
            onChange={setHideAge}
          />
          <PrivacyToggle
            label="Hide social media"
            desc="IG/TikTok/etc. link"
            checked={hideSocial}
            onChange={setHideSocial}
          />
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" variant="gold" size="lg" disabled={loading}>
          {loading ? "Saving..." : "Save Profile"}
        </Button>
      </div>
    </form>
  );
}

function PrivacyToggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted border border-border"
        )}
      >
        <span
          className={cn(
            "inline-flex h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
