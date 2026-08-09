"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waForgotPasswordUrl } from "@/lib/contact";

/**
 * Lupa password — diajukan lewat WhatsApp CS (diproses admin).
 *
 * Alur: user isi email (+ nama akun opsional) → tekan kirim → WhatsApp terbuka
 * dengan pesan yang SUDAH berisi datanya, jadi CS tak perlu bertanya ulang.
 *
 * Sengaja TIDAK mengecek email ke database: kalau server menjawab "email tak
 * terdaftar", orang bisa memakai halaman ini untuk menebak siapa saja yang
 * punya akun di SOHO. Verifikasi dilakukan admin lewat WhatsApp.
 */
export function ForgotForm() {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");

  const canSubmit = email.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    window.open(
      waForgotPasswordUrl(email.trim(), name.trim() || undefined),
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <div className="w-full">
      <Link
        href="/auth"
        className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sign in
      </Link>

      <h1 className="text-2xl font-bold text-white">Forgot password?</h1>
      <p className="mt-2 text-sm text-white/70 leading-relaxed">
        Send us your account details on WhatsApp and our team will help you
        reset your password.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <div className="space-y-1.5">
          <label className="block text-xs text-white/70">
            Email <span className="text-white">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            required
            autoFocus
            autoComplete="email"
            className="w-full h-12 px-3 rounded-md bg-white/10 border border-white/25 text-white placeholder:text-white/40 focus:outline-none focus:border-white/60 transition"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-white/70">
            Account name <span className="text-white/40">(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name on the account"
            maxLength={80}
            className="w-full h-12 px-3 rounded-md bg-white/10 border border-white/25 text-white placeholder:text-white/40 focus:outline-none focus:border-white/60 transition"
          />
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={!canSubmit}
          className="w-full bg-[#f0e6d2] text-[#8d1312] hover:bg-white text-base font-semibold h-14 rounded-full disabled:opacity-60"
        >
          <MessageCircle className="h-5 w-5" />
          Send via WhatsApp
        </Button>

        <p className="text-[11px] text-white/50 text-center leading-relaxed pt-1">
          WhatsApp will open with your details already filled in. Our team
          verifies it first, then resets your password.
        </p>
      </form>
    </div>
  );
}
