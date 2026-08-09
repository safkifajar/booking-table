"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waForgotPasswordUrl } from "@/lib/contact";

/**
 * Lupa password — diajukan lewat WhatsApp CS (diproses admin).
 *
 * Alur: user isi email → tekan "Forgot Password" → WhatsApp terbuka dengan
 * pesan yang SUDAH berisi emailnya, jadi CS tak perlu bertanya ulang.
 *
 * Sengaja TIDAK mengecek email ke database: kalau server menjawab "email tak
 * terdaftar", orang bisa memakai halaman ini untuk menebak siapa saja yang
 * punya akun di SOHO. Verifikasi dilakukan admin lewat WhatsApp.
 */
export function ForgotForm() {
  const [email, setEmail] = React.useState("");
  const canSubmit = email.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    window.open(
      waForgotPasswordUrl(email.trim()),
      "_blank",
      "noopener,noreferrer"
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
          Enter your account email. We&apos;ll open WhatsApp so our team can
          help you reset the password.
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
            className="h-12 w-full rounded-md border border-white/25 bg-white/10 px-3 text-white transition placeholder:text-white/40 focus:border-white/60 focus:outline-none"
          />
        </div>
      </div>

      {/* Tombol menempel di bawah layar */}
      <div className="mt-auto pt-6">
        <Button
          type="submit"
          size="lg"
          disabled={!canSubmit}
          className="h-14 w-full rounded-full bg-[#f0e6d2] text-base font-semibold text-[#8d1312] hover:bg-white disabled:opacity-60"
        >
          Forgot Password
        </Button>
      </div>
    </form>
  );
}
