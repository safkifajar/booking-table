"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/lib/actions";
import { DatePicker } from "@/components/ui/date-picker";
import { FramedCupIllustration } from "./OnboardingIllustration";
import { Select } from "@/components/ui/select";
import { cn, getActionErrorMessage } from "@/lib/utils";
import { PhotoUploader } from "./PhotoUploader";
import { PromptPicker } from "./PromptPicker";
import { InterestPicker } from "./InterestPicker";
import { MAX_INTERESTS } from "./interests";

const LOOKING_FOR = [
  { value: "relationship", label: "Relationship" },
  { value: "casual", label: "Casual Date" },
  { value: "friendship", label: "Friendship" },
];

// Opsi gender — value disimpan (cocok enum DB male/female), label ditampilkan.
// "" = prefer not to say. (CMB-style: satu pertanyaan, list pilihan.)
const GENDER_OPTIONS = [
  { value: "female", label: "Woman" },
  { value: "male", label: "Man" },
  { value: "", label: "Prefer not to say" },
];

// "Interested in" — value cocok enum DB (male/female/both). Framing netral,
// bukan "date with".
const INTERESTED_OPTIONS = [
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
  { value: "both", label: "Everyone" },
  { value: "", label: "Prefer not to say" },
];

// Prompt ice-breaker bertema social house (bukan dating) — pemantik obrolan di
// venue. User pilih & jawab, maks 5.
const PROMPT_OPTIONS = [
  "Tonight I'm in the mood for…",
  "My go-to order here is…",
  "You'll usually find me…",
  "The perfect night out is…",
  "Ask me about…",
  "I'll always say yes to…",
  "A little-known fact about me…",
  "My hidden talent is…",
  "On repeat right now…",
  "My karaoke go-to is…",
  "Let's talk about…",
  "The best way to break the ice with me…",
  "I'm here to…",
  "My kind of crowd is…",
];
const MAX_PROMPTS = 5;


export function OnboardingWizard({
  next,
  initialName,
  initialPhotos,
}: {
  next: string;
  initialName: string;
  initialPhotos: string[];
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<2 | 3>(2);
  // Step 2 dibagi beberapa layar CMB-style: dob → gender → interested → intro →
  // photos → prompts → interests → details.
  const [step2Screen, setStep2Screen] = React.useState<
    | "dob"
    | "gender"
    | "interested"
    | "intro"
    | "photos"
    | "prompts"
    | "interests"
    | "details"
  >("dob");
  // photos disimpan di server (bukan draft sessionStorage). Init dari server.
  const [photos, setPhotos] = React.useState<string[]>(initialPhotos);
  // Prompt ice-breaker terpilih (persist di draft).
  const [prompts, setPrompts] = React.useState<
    { prompt: string; answer: string }[]
  >([]);
  const [genderPicked, setGenderPicked] = React.useState(false);
  const [interestedPicked, setInterestedPicked] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Step 2 — data diri
  const [birthDate, setBirthDate] = React.useState("");
  const [gender, setGender] = React.useState("");
  const [interestedIn, setInterestedIn] = React.useState("");
  const [area, setArea] = React.useState("");
  const [socialLink, setSocialLink] = React.useState("");
  // Step 3 — interest & preferensi
  const [lookingFor, setLookingFor] = React.useState("");
  const [musicPref, setMusicPref] = React.useState("");
  const [favFood, setFavFood] = React.useState("");
  const [favDrink, setFavDrink] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [hobbies, setHobbies] = React.useState<string[]>([]);

  // Persist draft ke sessionStorage supaya tak hilang saat refresh.
  const STORAGE_KEY = "soho_onboarding_draft";
  const restored = React.useRef(false);

  React.useEffect(() => {
    // queueMicrotask: hindari setState sinkron di body effect (cascading render).
    queueMicrotask(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (d.step === 3) setStep(3);
          setBirthDate(d.birthDate ?? "");
          setGender(d.gender ?? "");
          setInterestedIn(d.interestedIn ?? "");
          // Tandai pilihan yg sudah diisi (biar tombol Next tak terkunci saat balik).
          if (typeof d.gender === "string") setGenderPicked(true);
          if (typeof d.interestedIn === "string") setInterestedPicked(true);
          // Lanjut dari layar terakhir yg tersimpan; fallback infer dari isian.
          if (
            d.step2Screen === "gender" ||
            d.step2Screen === "interested" ||
            d.step2Screen === "intro" ||
            d.step2Screen === "photos" ||
            d.step2Screen === "prompts" ||
            d.step2Screen === "interests" ||
            d.step2Screen === "details"
          ) {
            setStep2Screen(d.step2Screen);
          } else if (typeof d.interestedIn === "string") {
            setStep2Screen("details");
          } else if (typeof d.gender === "string") {
            setStep2Screen("interested");
          } else if (d.birthDate) {
            setStep2Screen("gender");
          }
          setArea(d.area ?? "");
          setSocialLink(d.socialLink ?? "");
          setLookingFor(d.lookingFor ?? "");
          setMusicPref(d.musicPref ?? "");
          setFavFood(d.favFood ?? "");
          setFavDrink(d.favDrink ?? "");
          setBio(d.bio ?? "");
          setHobbies(Array.isArray(d.hobbies) ? d.hobbies : []);
          setPrompts(Array.isArray(d.prompts) ? d.prompts : []);
        }
      } catch {
        /* abaikan draft rusak */
      }
      restored.current = true;
    });
  }, []);

  React.useEffect(() => {
    if (!restored.current) return; // jangan timpa sebelum restore selesai
    const draft = {
      step,
      step2Screen,
      birthDate,
      gender,
      interestedIn,
      area,
      socialLink,
      lookingFor,
      musicPref,
      favFood,
      favDrink,
      bio,
      hobbies,
      prompts,
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* storage penuh — abaikan */
    }
  }, [
    step,
    step2Screen,
    birthDate,
    gender,
    interestedIn,
    area,
    socialLink,
    lookingFor,
    musicPref,
    favFood,
    favDrink,
    bio,
    hobbies,
    prompts,
  ]);

async function handleFinish() {
    setSaving(true);
    try {
      await completeOnboarding({
        birthDate,
        gender: (gender as "male" | "female" | "") || undefined,
        interestedIn:
          (interestedIn as "male" | "female" | "both" | "") || undefined,
        area: area.trim() || undefined,
        socialLink: socialLink.trim() || undefined,
        lookingFor:
          (lookingFor as "relationship" | "casual" | "friendship" | "") ||
          undefined,
        musicPref: musicPref.trim() || undefined,
        favFood: favFood.trim() || undefined,
        favDrink: favDrink.trim() || undefined,
        bio: bio.trim() || undefined,
        hobbies,
        prompts: prompts.length ? prompts : undefined,
      });
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* abaikan */
      }
      toast.success("Profile complete! Welcome 🎉");
      router.push(next || "/");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to save"));
      setSaving(false);
    }
  }

  // Urutan layar 1-pertanyaan step 2 (CMB-style) — untuk back & hide-stepper.
  const CHOICE_ORDER = [
    "dob",
    "gender",
    "interested",
    "intro",
    "photos",
    "prompts",
    "interests",
  ] as const;
  const isChoiceScreen =
    step === 2 && (CHOICE_ORDER as readonly string[]).includes(step2Screen);
  const showChoiceBack = isChoiceScreen;

  function choiceBack() {
    const idx = (CHOICE_ORDER as readonly string[]).indexOf(step2Screen);
    if (idx > 0) setStep2Screen(CHOICE_ORDER[idx - 1]);
    else router.back();
  }

  return (
    <div className={cn("w-full max-w-md mx-auto", showChoiceBack && "pt-12")}>
      {/* Back panah — pojok kiri-atas (di layar 1-pertanyaan). */}
      {showChoiceBack && (
        <button
          type="button"
          aria-label="Back"
          onClick={choiceBack}
          className="fixed left-4 top-4 z-20 inline-flex items-center justify-center h-10 w-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      {/* Skip kanan-atas — hanya di layar prompts (opsional). */}
      {step === 2 && step2Screen === "prompts" && (
        <button
          type="button"
          onClick={() => setStep2Screen("interests")}
          className="fixed right-4 top-4 z-20 text-sm font-medium text-primary hover:underline"
        >
          Skip
        </button>
      )}
      {/* Counter "N left" kanan-atas — layar interests (ala CMB). */}
      {step === 2 && step2Screen === "interests" && (
        <span className="fixed right-4 top-4 z-20 rounded-full border border-primary/50 px-3 py-1 text-xs font-semibold text-primary">
          {MAX_INTERESTS - hobbies.length} left
        </span>
      )}
      {/* Progress + step label — disembunyikan di layar 1-pertanyaan ala CMB. */}
      {!isChoiceScreen && (
        <>
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  s <= step ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground mb-1">
            Step {step} of 3
          </p>
        </>
      )}
      <h1 className="text-xl font-bold mb-1">
        {step === 3
          ? "Interests & preferences"
          : step2Screen === "dob"
            ? "When's your birthday?"
            : step2Screen === "gender"
              ? "What's your gender?"
              : step2Screen === "interested"
                ? "Who are you interested in?"
                : step2Screen === "intro"
                  ? "Add a face & a few details so people can say hi"
                  : step2Screen === "photos"
                    ? "Add up to 3 photos"
                    : step2Screen === "prompts"
                      ? "Pick a prompt or two"
                      : step2Screen === "interests"
                        ? "What do you like?"
                        : `Hi, ${initialName} 👋`}
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        {step === 3
          ? "So it's easy to find the right vibe at SOHO."
          : step2Screen === "dob"
            ? "We use it to confirm you're of legal age."
            : step2Screen === "gender"
              ? "Your gender stays hidden and can't be changed later."
              : step2Screen === "interested"
                ? "So we can connect you with the right people."
                : step2Screen === "intro"
                  ? "A photo and a couple of notes help the room get to know you at SOHO."
                  : step2Screen === "photos"
                    ? "Show your face so people can recognize you at SOHO. At least 1 required."
                    : step2Screen === "prompts"
                      ? "Give people something to break the ice with. Answer up to 5 — even one helps."
                      : step2Screen === "interests"
                        ? `Pick up to ${MAX_INTERESTS} interests for your profile.`
                        : "Fill in your personal details."}
      </p>

      {/* Step 2 · layar DATE OF BIRTH — pertanyaan pertama (CMB-style) */}
      {step === 2 && step2Screen === "dob" ? (
        <div className="pb-28">
          <DatePicker
            value={birthDate}
            onChange={setBirthDate}
            max={new Date().toISOString().slice(0, 10)}
          />

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                disabled={!birthDate}
                onClick={() => setStep2Screen("gender")}
              >
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : /* Step 2 · layar GENDER — satu pertanyaan, list pilihan (CMB-style) */
      step === 2 && step2Screen === "gender" ? (
        <div className="space-y-1 pb-28">
          <div>
            {GENDER_OPTIONS.map((o) => {
              const active = genderPicked && gender === o.value;
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => {
                    setGender(o.value);
                    setGenderPicked(true);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between py-4 text-left transition border-b border-border",
                    active ? "text-primary" : "hover:text-foreground"
                  )}
                >
                  <span className="text-base font-medium">{o.label}</span>
                  <span
                    className={cn(
                      "h-6 w-6 rounded-full border flex items-center justify-center shrink-0",
                      active
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40"
                    )}
                  >
                    {active && <Check className="h-4 w-4" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                disabled={!genderPicked}
                onClick={() => setStep2Screen("interested")}
              >
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step === 2 && step2Screen === "interested" ? (
        /* Step 2 · layar INTERESTED IN — satu pertanyaan (CMB-style) */
        <div className="space-y-1 pb-28">
          <div>
            {INTERESTED_OPTIONS.map((o) => {
              const active = interestedPicked && interestedIn === o.value;
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => {
                    setInterestedIn(o.value);
                    setInterestedPicked(true);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between py-4 text-left transition border-b border-border",
                    active ? "text-primary" : "hover:text-foreground"
                  )}
                >
                  <span className="text-base font-medium">{o.label}</span>
                  <span
                    className={cn(
                      "h-6 w-6 rounded-full border flex items-center justify-center shrink-0",
                      active
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40"
                    )}
                  >
                    {active && <Check className="h-4 w-4" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                disabled={!interestedPicked}
                onClick={() => setStep2Screen("intro")}
              >
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step === 2 && step2Screen === "intro" ? (
        /* Step 2 · layar INTRO — transisi ke data profil (vibe SOHO) */
        <div className="flex flex-col items-center text-center min-h-[70vh] pb-28">
          <div className="flex-1 flex items-center justify-center">
            <FramedCupIllustration className="w-64 h-64 max-w-full" />
          </div>
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                onClick={() => setStep2Screen("photos")}
              >
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step === 2 && step2Screen === "photos" ? (
        /* Step 2 · layar PHOTOS — upload foto profil (min 1) */
        <div className="pb-28">
          <PhotoUploader photos={photos} onChange={setPhotos} />

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                disabled={photos.length < 1}
                onClick={() => setStep2Screen("prompts")}
              >
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step === 2 && step2Screen === "prompts" ? (
        /* Step 2 · layar PROMPTS — ice-breaker (opsional, bisa Skip) */
        <div className="pb-28">
          <PromptPicker
            prompts={prompts}
            onChange={setPrompts}
            options={PROMPT_OPTIONS}
            max={MAX_PROMPTS}
          />

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                onClick={() => setStep2Screen("interests")}
              >
                {prompts.length > 0 ? "Next" : "Skip for now"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step === 2 && step2Screen === "interests" ? (
        /* Step 2 · layar INTERESTS — "What do you like?" (CMB-style) */
        <div className="pb-28">
          <InterestPicker selected={hobbies} onChange={setHobbies} />

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                onClick={() => setStep2Screen("details")}
              >
                {hobbies.length > 0 ? "Next" : "Skip for now"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step === 2 ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStep2Screen("interests")}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <Field label="Address">
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. North Purwokerto"
              maxLength={120}
              className={inputCls}
            />
          </Field>
          <Field label="Social media">
            <input
              type="text"
              value={socialLink}
              onChange={(e) => setSocialLink(e.target.value)}
              placeholder="@namauser"
              maxLength={200}
              className={inputCls}
            />
          </Field>

          <Button
            variant="gold"
            size="lg"
            className="w-full"
            onClick={() => setStep(3)}
          >
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Looking for">
            <Select
              value={lookingFor}
              onChange={setLookingFor}
              options={[
                { value: "", label: "Prefer not to say" },
                ...LOOKING_FOR.map((o) => ({ value: o.value, label: o.label })),
              ]}
            />
          </Field>

          <Field label="Favorite music">
            <input
              type="text"
              value={musicPref}
              onChange={(e) => setMusicPref(e.target.value)}
              placeholder="e.g. pop, jazz"
              maxLength={120}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Favorite food">
              <input
                type="text"
                value={favFood}
                onChange={(e) => setFavFood(e.target.value)}
                maxLength={120}
                className={inputCls}
              />
            </Field>
            <Field label="Favorite drink">
              <input
                type="text"
                value={favDrink}
                onChange={(e) => setFavDrink(e.target.value)}
                maxLength={120}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Short bio">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="A short story about yourself"
              className={cn(inputCls, "h-auto py-2 resize-none")}
            />
          </Field>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setStep(2)}
              disabled={saving}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button
              variant="gold"
              size="lg"
              className="flex-1"
              onClick={handleFinish}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Finish & Enter"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60 transition";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
