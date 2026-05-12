"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { signInAnonymous, signInWithMagicLink } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Mail, Sparkles, ArrowLeft } from "lucide-react";
import Link from "next/link";

export function AuthForm() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const [mode, setMode] = React.useState<"choose" | "email" | "guest">("choose");
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [emailSent, setEmailSent] = React.useState(false);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Email tidak valid");
      return;
    }
    setLoading(true);
    try {
      await signInWithMagicLink(email, next);
      setEmailSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal kirim email");
    } finally {
      setLoading(false);
    }
  }

  async function handleGuestSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error("Nama minimal 2 karakter");
      return;
    }
    setLoading(true);
    try {
      await signInAnonymous(trimmed, next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal sign in");
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground transition"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-medium">
            SOHO Social House
          </span>
        </div>
        <CardTitle className="text-2xl">
          {mode === "choose" && "Welcome"}
          {mode === "email" && (emailSent ? "Cek email kamu" : "Sign in dengan email")}
          {mode === "guest" && "Mulai sebagai tamu"}
        </CardTitle>
        <CardDescription>
          {mode === "choose" && "Pilih cara masuk untuk reserve meja atau join malam ini."}
          {mode === "email" && !emailSent && "Kami kirimkan magic link — tinggal klik."}
          {mode === "email" && emailSent && `Link sudah dikirim ke ${email}. Buka untuk lanjut.`}
          {mode === "guest" && "Cukup masukkan nama — cocok untuk demo cepat."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "choose" && (
          <>
            <Button
              variant="gold"
              size="lg"
              className="w-full"
              onClick={() => setMode("email")}
            >
              <Mail className="h-4 w-4" /> Lanjut dengan Email
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => setMode("guest")}
            >
              <Sparkles className="h-4 w-4" /> Masuk sebagai Tamu (Demo)
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              Sign in via email tidak butuh password. Mode tamu hanya untuk demo.
            </p>
          </>
        )}

        {mode === "email" && !emailSent && (
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <input
              type="email"
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              className="w-full h-11 px-3 rounded-md bg-input border border-border text-foreground focus:outline-none focus:border-primary/60 transition"
            />
            <Button type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
              {loading ? "Mengirim..." : "Kirim Magic Link"}
            </Button>
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="block w-full text-xs text-muted-foreground hover:text-foreground"
            >
              ← Pilihan lain
            </button>
          </form>
        )}

        {mode === "email" && emailSent && (
          <div className="space-y-3">
            <div className="rounded-md bg-primary/10 border border-primary/30 p-3 text-sm">
              Buka email kamu dan klik link untuk lanjut. Bisa tutup tab ini.
            </div>
            <button
              onClick={() => {
                setEmailSent(false);
                setEmail("");
              }}
              className="block w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Pakai email lain
            </button>
          </div>
        )}

        {mode === "guest" && (
          <form onSubmit={handleGuestSubmit} className="space-y-3">
            <input
              type="text"
              placeholder="Nama panggilan kamu"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              minLength={2}
              maxLength={30}
              className="w-full h-11 px-3 rounded-md bg-input border border-border text-foreground focus:outline-none focus:border-primary/60 transition"
            />
            <Button type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
              {loading ? "Masuk..." : "Mulai"}
            </Button>
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="block w-full text-xs text-muted-foreground hover:text-foreground"
            >
              ← Pilihan lain
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
