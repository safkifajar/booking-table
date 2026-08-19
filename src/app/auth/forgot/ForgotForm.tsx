"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waForgotPasswordUrl } from "@/lib/contact";
import { requestPasswordReset } from "@/lib/auth-v2/reset-password";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Lupa password — tautan reset dikirim lewat email.
 *
 * WhatsApp SENGAJA dipertahankan sebagai jalur cadangan: sebagian tamu bar
 * mendaftar dengan email yang jarang dibuka, dan tanpa jalur kedua mereka
 * terkunci dari akunnya sendiri.
 *
 * Layar sukses TIDAK memberi tahu apakah email itu terdaftar. Kalau
 * membedakan jawabannya, halaman ini jadi alat menebak siapa saja yang punya
 * akun di SOHO — karena itu server pun selalu menjawab sukses.
 */
export function ForgotForm({ contactWa }: { contactWa?: string | null }) {
  const [email, setEmail] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && !sending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(getActionErrorMessage(err, "Couldn't send the email. Try again."));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] w-full flex-col">
        <Link
          href="/auth"
          aria-label="Back to sign in"
          className="-ml-2.5 inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>

        <div className="mt-4">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
            <MailCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-white">Check your email</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            If{" "}
            <span className="font-medium text-white">{email.trim()}</span> has an
            account, we&apos;ve sent a link to reset your password. It expires in
            30 minutes.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-white/50">
            Nothing arrived? Check your spam folder, or contact us on WhatsApp.
          </p>
        </div>

        <div className="mt-auto space-y-3 pt-6">
          <a
            href={waForgotPasswordUrl(email.trim(), contactWa)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-14 w-full items-center justify-center rounded-full border border-white/25 text-base font-semibold text-white transition hover:bg-white/10"
          >
            Contact us on WhatsApp
          </a>
          <Button
            type="button"
            size="lg"
            onClick={() => {
              setSent(false);
              setError(null);
            }}
            className="h-14 w-full rounded-full bg-[#f0e6d2] text-base font-semibold text-[#8d1312] hover:bg-white"
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    // Konten rata ATAS, tombol didorong ke BAWAH layar.
    <form
      onSubmit={handleSubmit}
      className="flex min-h-[calc(100dvh-4rem)] w-full flex-col"
    >
      {/* Back — digeser -2.5 (setengah padding tombol) supaya ikonnya LURUS
          dengan judul/deskripsi/field di bawahnya. */}
      <Link
        href="/auth"
        aria-label="Back to sign in"
        className="-ml-2.5 inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      {/* Judul + deskripsi + field — semua rata kiri di atas */}
      <div className="mt-4">
        <h1 className="text-2xl font-bold text-white">Forgot password?</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          Enter your account email and we&apos;ll send you a link to set a new
          password.
        </p>

        <div className="mt-6 space-y-1.5">
          <label htmlFor="forgot-email" className="block text-xs text-white/70">
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            required
            autoFocus
            autoComplete="email"
            disabled={sending}
            className="h-12 w-full rounded-md border border-white/25 bg-white/10 px-3 text-white transition placeholder:text-white/40 focus:border-white/60 focus:outline-none disabled:opacity-60"
          />
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Tombol menempel di bawah layar */}
      <div className="mt-auto space-y-3 pt-6">
        <Button
          type="submit"
          size="lg"
          disabled={!canSubmit}
          className="h-14 w-full rounded-full bg-[#f0e6d2] text-base font-semibold text-[#8d1312] hover:bg-white disabled:opacity-60"
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          Send reset link
        </Button>

        {/* Jalur cadangan — tamu yang tak bisa membuka emailnya. */}
        <a
          href={waForgotPasswordUrl(email.trim(), contactWa)}
          target="_blank"
          rel="noopener noreferrer"
          className="block py-1 text-center text-sm text-white/60 underline underline-offset-4 transition hover:text-white"
        >
          Can&apos;t access your email? Contact us on WhatsApp
        </a>
      </div>
    </form>
  );
}
