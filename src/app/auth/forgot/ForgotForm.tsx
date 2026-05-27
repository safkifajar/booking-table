"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Mail, Check } from "lucide-react";
import { requestPasswordReset } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { getActionErrorMessage } from "@/lib/utils";

export function ForgotForm() {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Email tidak valid");
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset({ email });
      setSent(true);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal kirim email reset"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <Link
            href="/auth"
            className="text-muted-foreground hover:text-foreground transition"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-medium">
            SOHO Social House
          </span>
        </div>
        <CardTitle className="text-2xl">
          {sent ? "Cek email kamu" : "Lupa password?"}
        </CardTitle>
        <CardDescription>
          {sent
            ? `Kami sudah kirim link reset password ke ${email}. Buka email-nya, klik link, lalu set password baru.`
            : "Tidak apa-apa. Masukkan email akunmu, kami kirim link reset password."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sent ? (
          <>
            <div className="rounded-md bg-primary/10 border border-primary/30 p-3 text-sm flex items-start gap-2">
              <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1">Link terkirim</p>
                <p className="text-xs text-muted-foreground">
                  Kalau tidak masuk inbox dalam beberapa menit, cek folder Spam.
                  Pastikan email yang dimasukkan benar dan sudah terdaftar.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/auth">Kembali ke Sign In</Link>
            </Button>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="block w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Pakai email lain
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="email@kamu.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
                className="w-full h-11 pl-10 pr-3 rounded-md bg-input border border-border text-foreground focus:outline-none focus:border-primary/60 transition"
              />
            </div>
            <Button
              type="submit"
              variant="gold"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Mengirim..." : "Kirim Link Reset"}
            </Button>
            <Link
              href="/auth"
              className="block text-center text-xs text-muted-foreground hover:text-foreground"
            >
              ← Kembali ke Sign In
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
