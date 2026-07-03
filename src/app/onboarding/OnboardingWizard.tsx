"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/lib/actions";
import { DatePicker } from "@/components/ui/date-picker";
import { FramedCupIllustration } from "./OnboardingIllustration";
import { cn, getActionErrorMessage } from "@/lib/utils";
import { PhotoUploader } from "./PhotoUploader";
import { PromptPicker } from "./PromptPicker";
import { InterestPicker } from "./InterestPicker";
import { MAX_INTERESTS } from "./interests";
import { PROMPT_OPTIONS, MAX_PROMPTS } from "./prompts";
import { EDUCATION_OPTIONS } from "@/lib/education";
import { RELIGION_OPTIONS } from "@/lib/religion";
import { HeightWheel } from "./HeightWheel";


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
  // Onboarding dibagi beberapa layar CMB-style: dob → gender → interested → intro →
  // photos → prompts → interests → education → height → religion → address →
  // social (finish).
  const [step2Screen, setStep2Screen] = React.useState<
    | "dob"
    | "gender"
    | "interested"
    | "intro"
    | "photos"
    | "prompts"
    | "interests"
    | "education"
    | "height"
    | "religion"
    | "address"
    | "social"
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
  const [education, setEducation] = React.useState("");
  const [heightCm, setHeightCm] = React.useState<number | null>(null);
  const [religion, setReligion] = React.useState("");
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
            d.step2Screen === "education" ||
            d.step2Screen === "height" ||
            d.step2Screen === "religion" ||
            d.step2Screen === "address" ||
            d.step2Screen === "social"
          ) {
            setStep2Screen(d.step2Screen);
          } else if (d.step2Screen === "details") {
            // Draft lama: layar "details" digantikan address+social.
            setStep2Screen("address");
          } else if (typeof d.interestedIn === "string") {
            setStep2Screen("address");
          } else if (typeof d.gender === "string") {
            setStep2Screen("interested");
          } else if (d.birthDate) {
            setStep2Screen("gender");
          }
          setArea(d.area ?? "");
          setSocialLink(d.socialLink ?? "");
          setLookingFor(d.lookingFor ?? "");
          setEducation(d.education ?? "");
          setHeightCm(typeof d.heightCm === "number" ? d.heightCm : null);
          setReligion(d.religion ?? "");
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
      step2Screen,
      birthDate,
      gender,
      interestedIn,
      area,
      socialLink,
      lookingFor,
      education,
      heightCm,
      religion,
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
    step2Screen,
    birthDate,
    gender,
    interestedIn,
    area,
    socialLink,
    lookingFor,
    education,
    heightCm,
    religion,
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
        education:
          (education as
            | "high_school"
            | "diploma"
            | "bachelor"
            | "master"
            | "doctorate"
            | "other"
            | "") || undefined,
        heightCm: heightCm ?? undefined,
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
    "education",
    "height",
    "religion",
    "address",
    "social",
  ] as const;
  const isChoiceScreen = (CHOICE_ORDER as readonly string[]).includes(
    step2Screen
  );
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
      {/* Skip kanan-atas — layar opsional (prompts, education, dst). */}
      {step2Screen === "prompts" && (
        <button
          type="button"
          onClick={() => setStep2Screen("interests")}
          className="fixed right-4 top-4 z-20 text-sm font-medium text-primary hover:underline"
        >
          Skip
        </button>
      )}
      {step2Screen === "education" && (
        <button
          type="button"
          onClick={() => setStep2Screen("height")}
          className="fixed right-4 top-4 z-20 text-sm font-medium text-primary hover:underline"
        >
          Skip
        </button>
      )}
      {step2Screen === "height" && (
        <button
          type="button"
          onClick={() => setStep2Screen("religion")}
          className="fixed right-4 top-4 z-20 text-sm font-medium text-primary hover:underline"
        >
          Skip
        </button>
      )}
      {step2Screen === "religion" && (
        <button
          type="button"
          onClick={() => setStep2Screen("address")}
          className="fixed right-4 top-4 z-20 text-sm font-medium text-primary hover:underline"
        >
          Skip
        </button>
      )}
      {step2Screen === "social" && (
        <button
          type="button"
          onClick={handleFinish}
          disabled={saving}
          className="fixed right-4 top-4 z-20 text-sm font-medium text-primary hover:underline disabled:opacity-50"
        >
          Skip
        </button>
      )}
      {/* Counter "N left" kanan-atas — layar interests (ala CMB). */}
      {step2Screen === "interests" && (
        <span className="fixed right-4 top-4 z-20 rounded-full border border-primary/50 px-3 py-1 text-xs font-semibold text-primary">
          {MAX_INTERESTS - hobbies.length} left
        </span>
      )}
      <h1 className="text-xl font-bold mb-1">
        {step2Screen === "dob"
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
                        : step2Screen === "education"
                          ? "What's your highest education?"
                          : step2Screen === "height"
                            ? "How tall are you?"
                            : step2Screen === "religion"
                              ? "What's your religion?"
                              : step2Screen === "address"
                                ? "Where are you based?"
                                : step2Screen === "social"
                                  ? "Add your Instagram"
                                  : `Hi, ${initialName} 👋`}
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        {step2Screen === "dob"
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
                        : step2Screen === "education"
                          ? "Optional — it just helps people get to know you."
                          : step2Screen === "height"
                            ? "Optional — just another little detail about you."
                            : step2Screen === "religion"
                              ? "Optional — share it if you'd like, or skip."
                              : step2Screen === "address"
                                ? "Just your area — it helps people find their crowd at SOHO."
                                : step2Screen === "social"
                                  ? "Optional — let people connect with you off the floor."
                                  : "Fill in your personal details."}
      </p>

      {/* Step 2 · layar DATE OF BIRTH — pertanyaan pertama (CMB-style) */}
      {step2Screen === "dob" ? (
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
      step2Screen === "gender" ? (
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
                  className="w-full flex items-center justify-between py-4 text-left transition border-b border-border"
                >
                  <span
                    className={cn(
                      "text-base font-medium",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {o.label}
                  </span>
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
      ) : step2Screen === "interested" ? (
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
                  className="w-full flex items-center justify-between py-4 text-left transition border-b border-border"
                >
                  <span
                    className={cn(
                      "text-base font-medium",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {o.label}
                  </span>
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
      ) : step2Screen === "intro" ? (
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
      ) : step2Screen === "photos" ? (
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
      ) : step2Screen === "prompts" ? (
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
      ) : step2Screen === "interests" ? (
        /* Step 2 · layar INTERESTS — "What do you like?" (CMB-style) */
        <div className="pb-28">
          <InterestPicker selected={hobbies} onChange={setHobbies} />

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                onClick={() => setStep2Screen("education")}
              >
                {hobbies.length > 0 ? "Next" : "Skip for now"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step2Screen === "education" ? (
        /* Step 2 · layar EDUCATION — pendidikan terakhir (opsional, radio) */
        <div className="space-y-1 pb-28">
          <div>
            {EDUCATION_OPTIONS.map((o) => {
              const active = education === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() =>
                    setEducation((cur) => (cur === o.value ? "" : o.value))
                  }
                  className="w-full flex items-center justify-between py-4 text-left transition border-b border-border"
                >
                  <span
                    className={cn(
                      "text-base font-medium",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {o.label}
                  </span>
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
                onClick={() => setStep2Screen("height")}
              >
                {education ? "Next" : "Skip for now"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step2Screen === "height" ? (
        /* Step 2 · layar HEIGHT — tinggi badan cm (opsional, wheel picker) */
        <div className="pb-28">
          <div className="pt-6">
            <HeightWheel value={heightCm} onChange={setHeightCm} />
          </div>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                onClick={() => setStep2Screen("religion")}
              >
                {heightCm ? "Next" : "Skip for now"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step2Screen === "religion" ? (
        /* Step 2 · layar RELIGION — agama (opsional, radio) */
        <div className="space-y-1 pb-28">
          <div>
            {RELIGION_OPTIONS.map((o) => {
              const active = religion === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() =>
                    setReligion((cur) => (cur === o.value ? "" : o.value))
                  }
                  className="w-full flex items-center justify-between py-4 text-left transition border-b border-border"
                >
                  <span
                    className={cn(
                      "text-base font-medium",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {o.label}
                  </span>
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
                onClick={() => setStep2Screen("address")}
              >
                {religion ? "Next" : "Skip for now"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : step2Screen === "address" ? (
        /* Step 2 · layar ADDRESS — area/alamat (CMB-style, satu field) */
        <div className="pb-28">
          <input
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. North Purwokerto"
            maxLength={120}
            autoFocus
            className="w-full border-b border-border bg-transparent pb-3 text-lg focus:outline-none focus:border-primary/60 transition placeholder:text-muted-foreground/50"
          />

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                onClick={() => setStep2Screen("social")}
              >
                {area.trim() ? "Next" : "Skip for now"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* Step 2 · layar SOCIAL — Instagram (CMB-style, terakhir → Finish) */
        <div className="pb-28">
          <div className="flex items-center border-b border-border pb-3">
            <span className="text-lg text-muted-foreground/70 mr-1">@</span>
            <input
              type="text"
              value={socialLink.replace(/^@/, "")}
              onChange={(e) => {
                // Simpan sbg handle "@username" biar socialHref → link Instagram.
                const handle = e.target.value.replace(/^@+/, "").trim();
                setSocialLink(handle ? `@${handle}` : "");
              }}
              placeholder="username"
              maxLength={200}
              autoFocus
              inputMode="text"
              autoCapitalize="none"
              className="flex-1 min-w-0 bg-transparent text-lg focus:outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="max-w-md mx-auto px-4 py-3">
              <Button
                variant="gold"
                size="lg"
                className="w-full rounded-full h-14"
                onClick={handleFinish}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    Finish &amp; Enter <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
