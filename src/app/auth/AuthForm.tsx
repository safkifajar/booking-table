"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  signInAction,
  signUpAction,
  magicLinkAction,
} from "@/lib/auth-v2/actions";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Lock, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "choose" | "signin" | "signup" | "magic";

export function AuthForm() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const checkEmail = sp.get("check_email");
  const [mode, setMode] = React.useState<Mode>(checkEmail ? "magic" : "choose");

  return (
    <div className="auth-shell w-full max-w-sm mx-auto flex flex-col items-center text-center">
      {/* Logo brand SOHO (sudah termasuk "SOCIAL HOUSE"). Aset statis → <img>
          biasa, tak perlu optimasi next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-soho.jpeg"
        alt="SOHO Social House"
        className="w-48 sm:w-56 h-auto select-none pointer-events-none mb-6"
      />

      <h1 className="text-xl font-semibold text-[#f0e6d2]">{titleFor(mode)}</h1>
      <p className="text-sm text-[#f0e6d2]/70 mt-1 mb-6">{descFor(mode)}</p>

      <div className="w-full space-y-3 text-left">
        {mode === "choose" && <ChooseMode setMode={setMode} />}
        {mode === "signin" && (
          <PasswordForm
            mode="signin"
            next={next}
            onBack={() => setMode("choose")}
            onSwitch={() => setMode("signup")}
          />
        )}
        {mode === "signup" && (
          <PasswordForm
            mode="signup"
            next={next}
            onBack={() => setMode("choose")}
            onSwitch={() => setMode("signin")}
          />
        )}
        {mode === "magic" && (
          <MagicLinkForm
            next={next}
            initialSent={!!checkEmail}
            onBack={() => setMode("choose")}
          />
        )}
      </div>

      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 text-xs text-[#f0e6d2]/60 hover:text-[#f0e6d2] transition"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke beranda
      </Link>
    </div>
  );
}

function titleFor(mode: Mode): string {
  if (mode === "signin") return "Sign in";
  if (mode === "signup") return "Bikin akun baru";
  if (mode === "magic") return "Sign in dengan email";
  return "Welcome";
}

function descFor(mode: Mode): string {
  if (mode === "signin") return "Masuk dengan email & password kamu.";
  if (mode === "signup") return "Daftar sekali, login kapan saja.";
  if (mode === "magic") return "Kami kirimkan magic link — tinggal klik.";
  return "Pilih cara masuk untuk reserve meja atau join malam ini.";
}

// ============================================================
// MODE: CHOOSE
// ============================================================
function ChooseMode({ setMode }: { setMode: (m: Mode) => void }) {
  return (
    <>
      <Button
        variant="gold"
        size="lg"
        className="w-full"
        onClick={() => setMode("signin")}
      >
        <Lock className="h-4 w-4" /> Sign In (Email + Password)
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => setMode("signup")}
      >
        Bikin Akun Baru
      </Button>
      {/* Magic Link di-hide sementara. Aktifkan lagi kalau dibutuhkan:
      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border"></span>
        </div>
        <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
          <span className="bg-card px-2 text-muted-foreground">atau</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="lg"
        className="w-full"
        onClick={() => setMode("magic")}
      >
        <Mail className="h-4 w-4" /> Magic Link
      </Button>
      */}
    </>
  );
}

// ============================================================
// MODE: SIGN IN / SIGN UP (password)
// ============================================================
function PasswordForm({
  mode,
  next,
  onBack,
  onSwitch,
}: {
  mode: "signin" | "signup";
  next: string;
  onBack: () => void;
  onSwitch: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return toast.error("Email tidak valid");
    if (password.length < 6) return toast.error("Password minimal 6 karakter");
    if (mode === "signup" && displayName.trim().length < 2)
      return toast.error("Nama minimal 2 karakter");

    setLoading(true);
    try {
      const result =
        mode === "signup"
          ? await signUpAction({
              email,
              password,
              displayName: displayName.trim(),
              phone: phone.trim() || undefined,
              next,
            })
          : await signInAction({ email, password, next });

      // Kalau action return ke sini (bukan throw NEXT_REDIRECT), berarti error
      if (!result.ok && result.error) {
        toast.error(result.error);
        setLoading(false);
      }
      // Kalau sukses, sudah redirect — tidak perlu setLoading(false)
    } catch (err) {
      // NEXT_REDIRECT akan di-handle Next.js, tidak sampai sini
      const message = err instanceof Error ? err.message : "Gagal masuk";
      toast.error(message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === "signup" && (
        <input
          type="text"
          placeholder="Nama panggilan"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoFocus
          required
          minLength={2}
          maxLength={40}
          className={inputCls}
        />
      )}
      {mode === "signup" && (
        <input
          type="tel"
          placeholder="Nomor WA (cth: 0812...)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          className={inputCls}
        />
      )}
      <input
        type="email"
        placeholder="nama@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus={mode === "signin"}
        required
        autoComplete={mode === "signin" ? "email" : "new-password"}
        className={inputCls}
      />
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          placeholder="Password (min 6 karakter)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className={cn(inputCls, "pr-10")}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <Button type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
        {loading
          ? mode === "signup"
            ? "Membuat akun..."
            : "Masuk..."
          : mode === "signup"
            ? "Bikin Akun"
            : "Sign In"}
      </Button>

      {mode === "signup" && (
        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          Dengan mendaftar, kamu menyetujui{" "}
          <Link href="/terms" target="_blank" className="text-primary hover:underline">
            Syarat &amp; Ketentuan
          </Link>{" "}
          dan{" "}
          <Link href="/privacy" target="_blank" className="text-primary hover:underline">
            Kebijakan Privasi
          </Link>{" "}
          kami.
        </p>
      )}

      <div className="flex justify-between text-xs">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          ← Pilihan lain
        </button>
        <button
          type="button"
          onClick={onSwitch}
          className="text-primary hover:underline"
        >
          {mode === "signin" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// MODE: MAGIC LINK
// ============================================================
function MagicLinkForm({
  next,
  initialSent,
  onBack,
}: {
  next: string;
  initialSent: boolean;
  onBack: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(initialSent);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return toast.error("Email tidak valid");
    setLoading(true);
    try {
      const result = await magicLinkAction({ email, next });
      if (result.ok) {
        setSent(true);
      } else if (result.error) {
        toast.error(result.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal kirim email";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <div className="rounded-md bg-primary/10 border border-primary/30 p-3 text-sm">
          Link dikirim{email && ` ke ${email}`}. Buka email & klik link untuk masuk. Bisa tutup tab ini.
        </div>
        <button
          onClick={() => {
            setSent(false);
            setEmail("");
          }}
          className="block w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Pakai email lain
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        placeholder="nama@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
        required
        className={inputCls}
      />
      <Button type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
        {loading ? "Mengirim..." : "Kirim Magic Link"}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="block w-full text-xs text-muted-foreground hover:text-foreground"
      >
        ← Pilihan lain
      </button>
    </form>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-md bg-input border border-border text-foreground focus:outline-none focus:border-primary/60 transition";
