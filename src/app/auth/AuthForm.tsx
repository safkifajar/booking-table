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
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "choose" | "signin" | "signup" | "magic";

export function AuthForm() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const checkEmail = sp.get("check_email");
  const [mode, setMode] = React.useState<Mode>(checkEmail ? "magic" : "choose");

  // Landing (mode choose): logo besar + tagline di tengah, dua tombol di bawah,
  // consent Terms/Privacy — konsep app kencan (CMB-style). Mode form: layout
  // ringkas (logo kecil + form).
  if (mode === "choose") {
    return <AuthLanding setMode={setMode} />;
  }

  return (
    <div className="auth-shell relative w-full max-w-sm mx-auto flex flex-col items-center text-center">
      <button
        type="button"
        onClick={() => setMode("choose")}
        aria-label="Back"
        className="fixed left-4 top-4 z-20 inline-flex items-center justify-center h-10 w-10 rounded-full text-[#f0e6d2]/80 hover:text-[#f0e6d2] hover:bg-[#f0e6d2]/10 transition"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-soho.jpeg"
        alt="SOHO Social House"
        className="w-40 sm:w-48 h-auto select-none pointer-events-none mb-6"
      />

      <h1 className="text-xl font-semibold text-[#f0e6d2]">{titleFor(mode)}</h1>
      <p className="text-sm text-[#f0e6d2]/70 mt-1 mb-6">{descFor(mode)}</p>

      <div className="w-full space-y-3 text-left">
        {mode === "signin" && (
          <PasswordForm
            mode="signin"
            next={next}
            onSwitch={() => setMode("signup")}
          />
        )}
        {mode === "signup" && (
          <PasswordForm
            mode="signup"
            next={next}
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
    </div>
  );
}

// ============================================================
// LANDING (mode choose) — CMB-style
// ============================================================
function AuthLanding({ setMode }: { setMode: (m: Mode) => void }) {
  return (
    <div className="flex flex-col items-center text-center min-h-[80vh] w-full">
      {/* Logo + tagline — terpusat di area atas */}
      <div className="flex-1 flex flex-col items-center justify-center pt-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-soho.jpeg"
          alt="SOHO Social House"
          className="w-56 sm:w-64 h-auto select-none pointer-events-none"
        />
      </div>

      {/* Aksi + consent — di bawah */}
      <div className="w-full space-y-3 pb-2">
        <Button
          size="lg"
          className="w-full bg-[#f0e6d2] text-[#8d1312] hover:bg-white text-base font-semibold h-14 rounded-full"
          onClick={() => setMode("signup")}
        >
          I&apos;m new here
        </Button>
        <Button
          size="lg"
          className="w-full bg-[#4a0a09] text-[#f0e6d2] hover:bg-[#3a0807] text-base font-semibold h-14 rounded-full"
          onClick={() => setMode("signin")}
        >
          I&apos;ve been here before
        </Button>

        <p className="pt-3 text-xs text-[#f0e6d2]/70 leading-relaxed">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline hover:text-[#f0e6d2]">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-[#f0e6d2]">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}

function titleFor(mode: Mode): string {
  if (mode === "signin") return "Sign in";
  if (mode === "signup") return "Create a new account";
  if (mode === "magic") return "Sign in with email";
  return "Welcome";
}

function descFor(mode: Mode): string {
  if (mode === "signin") return "Sign in with your email & password.";
  if (mode === "signup") return "Sign up once, sign in anytime.";
  if (mode === "magic") return "We'll send you a magic link — just click it.";
  return "Choose how to sign in to reserve a table or join tonight.";
}

// ============================================================
// MODE: SIGN IN / SIGN UP (password)
// ============================================================
function PasswordForm({
  mode,
  next,
  onSwitch,
}: {
  mode: "signin" | "signup";
  next: string;
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
    if (!email.includes("@")) return toast.error("Invalid email");
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (mode === "signup" && displayName.trim().length < 2)
      return toast.error("Name must be at least 2 characters");

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
      const message = err instanceof Error ? err.message : "Sign in failed";
      toast.error(message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === "signup" && (
        <input
          type="text"
          placeholder="Nickname"
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
          placeholder="WhatsApp number (e.g. 0812...)"
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
          placeholder="Password (min 6 characters)"
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
            ? "Creating account..."
            : "Signing in..."
          : mode === "signup"
            ? "Create Account"
            : "Sign In"}
      </Button>

      {mode === "signup" && (
        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          By signing up, you agree to our{" "}
          <Link href="/terms" target="_blank" className="text-primary hover:underline">
            Terms &amp; Conditions
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      )}

      <div className="text-center text-xs">
        <button
          type="button"
          onClick={onSwitch}
          className="text-primary hover:underline"
        >
          {mode === "signin" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
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
    if (!email.includes("@")) return toast.error("Invalid email");
    setLoading(true);
    try {
      const result = await magicLinkAction({ email, next });
      if (result.ok) {
        setSent(true);
      } else if (result.error) {
        toast.error(result.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send email";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <div className="rounded-md bg-primary/10 border border-primary/30 p-3 text-sm">
          Link sent{email && ` to ${email}`}. Open your email & click the link to sign in. You can close this tab.
        </div>
        <button
          onClick={() => {
            setSent(false);
            setEmail("");
          }}
          className="block w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Use a different email
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
        {loading ? "Sending..." : "Send Magic Link"}
      </Button>
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="mx-auto flex items-center justify-center text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
    </form>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-md bg-input border border-border text-foreground focus:outline-none focus:border-primary/60 transition";
