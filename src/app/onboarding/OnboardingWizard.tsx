"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/lib/actions";
import { cn, getActionErrorMessage } from "@/lib/utils";
import type { HobbyGroup } from "@/lib/hobbies";

const LOOKING_FOR = [
  { value: "relationship", label: "Relationship" },
  { value: "casual", label: "Casual Date" },
  { value: "friendship", label: "Friendship" },
];


export function OnboardingWizard({
  next,
  initialName,
  hobbyGroups,
}: {
  next: string;
  initialName: string;
  hobbyGroups: HobbyGroup[];
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<2 | 3>(2);
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
          setArea(d.area ?? "");
          setSocialLink(d.socialLink ?? "");
          setLookingFor(d.lookingFor ?? "");
          setMusicPref(d.musicPref ?? "");
          setFavFood(d.favFood ?? "");
          setFavDrink(d.favDrink ?? "");
          setBio(d.bio ?? "");
          setHobbies(Array.isArray(d.hobbies) ? d.hobbies : []);
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
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* storage penuh — abaikan */
    }
  }, [
    step,
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
  ]);

  function toggleHobby(h: string) {
    setHobbies((prev) =>
      prev.includes(h)
        ? prev.filter((x) => x !== h)
        : [...prev, h].slice(0, 15)
    );
  }

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
      });
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* abaikan */
      }
      toast.success("Profil lengkap! Selamat datang 🎉");
      router.push(next || "/");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal menyimpan"));
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Progress */}
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
        Langkah {step} dari 3
      </p>
      <h1 className="text-xl font-bold mb-1">
        {step === 2 ? `Halo, ${initialName} 👋` : "Minat & preferensi"}
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        {step === 2
          ? "Lengkapi data diri kamu."
          : "Biar gampang nemu vibe yang cocok di SOHO."}
      </p>

      {step === 2 ? (
        <div className="space-y-4">
          <Field label="Tanggal lahir">
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </Field>
          <Field label="Jenis kelamin">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={inputCls}
            >
              <option value="">Tidak disebut</option>
              <option value="male">Pria</option>
              <option value="female">Wanita</option>
            </select>
          </Field>
          <Field label="Tertarik pada">
            <select
              value={interestedIn}
              onChange={(e) => setInterestedIn(e.target.value)}
              className={inputCls}
            >
              <option value="">Tidak disebut</option>
              <option value="male">Pria</option>
              <option value="female">Wanita</option>
              <option value="both">Keduanya</option>
            </select>
          </Field>
          <Field label="Alamat">
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="cth: Purwokerto Utara"
              maxLength={120}
              className={inputCls}
            />
          </Field>
          <Field label="Media sosial">
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
            Lanjut <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Mencari">
            <select
              value={lookingFor}
              onChange={(e) => setLookingFor(e.target.value)}
              className={inputCls}
            >
              <option value="">Tidak disebut</option>
              {LOOKING_FOR.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Hobi & minat (pilih beberapa)">
            <div className="space-y-3">
              {hobbyGroups.map((cat) => (
                <div key={cat.category}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
                    {cat.category}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.items.map((item) => item.name).map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => toggleHobby(h)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium border transition",
                          hobbies.includes(h)
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Field>

          <Field label="Preferensi musik">
            <input
              type="text"
              value={musicPref}
              onChange={(e) => setMusicPref(e.target.value)}
              placeholder="cth: pop, jazz"
              maxLength={120}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Makanan favorit">
              <input
                type="text"
                value={favFood}
                onChange={(e) => setFavFood(e.target.value)}
                maxLength={120}
                className={inputCls}
              />
            </Field>
            <Field label="Minuman favorit">
              <input
                type="text"
                value={favDrink}
                onChange={(e) => setFavDrink(e.target.value)}
                maxLength={120}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Bio singkat">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="Cerita singkat tentang kamu"
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
              <ArrowLeft className="h-4 w-4" /> Kembali
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
                  <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
                </>
              ) : (
                "Selesai & Masuk"
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
