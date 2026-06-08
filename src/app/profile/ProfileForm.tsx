"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Sparkles } from "lucide-react";
import { updateProfile } from "@/lib/actions";
import { getActionErrorMessage, cn } from "@/lib/utils";

// Hobi populer untuk preset chip — sesuai vibe SOHO Social House
const HOBBY_SUGGESTIONS = [
  "coffee",
  "live music",
  "wine",
  "cocktails",
  "photography",
  "travel",
  "running",
  "yoga",
  "movies",
  "books",
  "cooking",
  "gaming",
  "football",
  "basketball",
  "dancing",
  "fashion",
  "tech",
  "startup",
  "art",
  "design",
  "music production",
];

interface Props {
  initialDisplayName: string;
  initialHobbies: string[];
}

export function ProfileForm({ initialDisplayName, initialHobbies }: Props) {
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
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
      await updateProfile({ displayName: name, hobbies });
      toast.success("Profil tersimpan");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan"));
    } finally {
      setLoading(false);
    }
  }

  const unsuggested = HOBBY_SUGGESTIONS.filter((h) => !hobbies.includes(h));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Identitas</CardTitle>
          <CardDescription>
            Nama yang ditampilkan ke anggota meja lain dan host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Nama tampilan
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
        </CardContent>
      </Card>

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
          {/* Hobi terpilih */}
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

          {/* Tambah custom */}
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

          {/* Saran hobi */}
          {unsuggested.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Saran
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unsuggested.map((h) => (
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
          )}
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end gap-2 sticky bottom-0 bg-background/80 backdrop-blur-md py-3 -mx-4 px-4 sm:mx-0 sm:px-0 sm:bg-transparent sm:backdrop-blur-none border-t border-border sm:border-0">
        <Button type="submit" variant="gold" size="lg" disabled={loading}>
          {loading ? "Menyimpan..." : "Simpan Profil"}
        </Button>
      </div>
    </form>
  );
}
