"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  X,
  Plus,
  Sparkles,
  Mail,
  Phone,
  Cake,
  FileText,
  Users,
  Heart,
} from "lucide-react";
import { updateProfile } from "@/lib/actions";
import { getActionErrorMessage, cn } from "@/lib/utils";

/**
 * Preset minat dikelompokkan per kategori, relevan dgn vibe SOHO (social house/
 * bar). User boleh tetap menambah custom. Semua lowercase utk konsistensi.
 */
const HOBBY_CATEGORIES: { label: string; items: string[] }[] = [
  {
    label: "Musik & Hiburan",
    items: [
      "live music",
      "dj set",
      "karaoke",
      "rock",
      "jazz",
      "hip-hop",
      "edm",
      "indie",
      "vinyl",
      "music production",
    ],
  },
  {
    label: "Minuman & Kuliner",
    items: [
      "cocktails",
      "wine",
      "craft beer",
      "whiskey",
      "coffee",
      "mixology",
      "foodie",
      "shisha",
    ],
  },
  {
    label: "Aktivitas Sosial",
    items: [
      "billiard",
      "board game",
      "darts",
      "nobar",
      "stand-up comedy",
      "open mic",
    ],
  },
  {
    label: "Vibe & Gaya",
    items: [
      "nongkrong santai",
      "networking",
      "cari teman baru",
      "party",
      "fashion",
      "photography",
    ],
  },
  {
    label: "Lifestyle",
    items: [
      "travel",
      "gym",
      "football",
      "basketball",
      "movies",
      "gaming",
      "art",
      "books",
    ],
  },
];

type Gender = "" | "male" | "female";
type InterestedIn = "" | "male" | "female" | "both";

interface Props {
  email: string;
  initialDisplayName: string;
  initialPhone: string;
  initialBirthDate: string;
  initialBio: string;
  initialGender: Gender;
  initialInterestedIn: InterestedIn;
  initialHobbies: string[];
}

export function ProfileForm({
  email,
  initialDisplayName,
  initialPhone,
  initialBirthDate,
  initialBio,
  initialGender,
  initialInterestedIn,
  initialHobbies,
}: Props) {
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [phone, setPhone] = React.useState(initialPhone);
  const [birthDate, setBirthDate] = React.useState(initialBirthDate);
  const [bio, setBio] = React.useState(initialBio);
  const [gender, setGender] = React.useState<Gender>(initialGender);
  const [interestedIn, setInterestedIn] =
    React.useState<InterestedIn>(initialInterestedIn);
  const [hobbies, setHobbies] = React.useState<string[]>(initialHobbies);
  const [customInput, setCustomInput] = React.useState("");
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

  function addCustom(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = customInput.trim().toLowerCase();
    if (!cleaned) return;
    if (hobbies.includes(cleaned)) {
      toast.error("Hobi sudah dipilih");
      return;
    }
    if (hobbies.length >= 15) {
      toast.error("Maks 15 hobi");
      return;
    }
    setHobbies((prev) => [...prev, cleaned]);
    setCustomInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (name.length < 2) {
      toast.error("Nama minimal 2 karakter");
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
        hobbies,
      });
      toast.success("Profil tersimpan");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
    } finally {
      setLoading(false);
    }
  }

  // Saran per kategori, sembunyikan yg sudah dipilih.
  const suggestionGroups = HOBBY_CATEGORIES.map((cat) => ({
    label: cat.label,
    items: cat.items.filter((h) => !hobbies.includes(h)),
  })).filter((cat) => cat.items.length > 0);
  const bioLength = bio.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* IDENTITAS */}
      <Card>
        <CardHeader>
          <CardTitle>Identitas</CardTitle>
          <CardDescription>
            Info dasar akunmu. Email tidak bisa diubah dari sini.
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
              Nama tampilan *
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
              <Phone className="h-3 w-3" /> Nomor WA
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="cth: 081234567890"
              maxLength={20}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Birth date */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Cake className="h-3 w-3" /> Tanggal lahir
            </label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Jenis kelamin */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Jenis kelamin
            </label>
            <div className="flex gap-2">
              {([
                { value: "male", label: "Pria" },
                { value: "female", label: "Wanita" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setGender((g) => (g === opt.value ? "" : opt.value))
                  }
                  className={cn(
                    "flex-1 h-11 rounded-md border text-sm font-medium transition",
                    gender === opt.value
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-input border-border hover:border-primary/30"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Opsional. Ketuk lagi untuk batal pilih.
            </p>
          </div>

          {/* Tertarik pada */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Heart className="h-3 w-3" /> Tertarik pada
            </label>
            <div className="flex gap-2">
              {([
                { value: "male", label: "Pria" },
                { value: "female", label: "Wanita" },
                { value: "both", label: "Keduanya" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setInterestedIn((v) => (v === opt.value ? "" : opt.value))
                  }
                  className={cn(
                    "flex-1 h-11 rounded-md border text-sm font-medium transition",
                    interestedIn === opt.value
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-input border-border hover:border-primary/30"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Opsional. Ketuk lagi untuk batal pilih.
            </p>
          </div>

          {/* Bio */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> Bio singkat
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
              placeholder="Cerita singkat tentang kamu, max 280 karakter"
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
            Hobi & Minat
          </CardTitle>
          <CardDescription>
            Bantu host & teman semeja kenal kamu — vibe match jadi gampang. Pilih
            dari preset atau tambah hobi sendiri. Maks 15 hobi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Hobi kamu ({hobbies.length})
            </p>
            {hobbies.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Belum ada. Pilih dari saran di bawah atau tambah sendiri.
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

          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Tambah hobi sendiri
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="cth: panjat tebing"
                maxLength={30}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom(e);
                  }
                }}
                className="flex-1 h-10 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={addCustom}
                disabled={!customInput.trim()}
              >
                <Plus className="h-4 w-4" />
                Tambah
              </Button>
            </div>
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

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" variant="gold" size="lg" disabled={loading}>
          {loading ? "Menyimpan..." : "Simpan Profil"}
        </Button>
      </div>
    </form>
  );
}
