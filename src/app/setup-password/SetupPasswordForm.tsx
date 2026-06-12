"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { setupPasswordWithToken } from "@/lib/staff-actions";
import { cn } from "@/lib/utils";

interface Props {
  token: string;
  email: string;
}

export function SetupPasswordForm({ token, email }: Props) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password minimal 6 karakter");
      return;
    }
    if (password !== confirmPassword) {
      setError("Konfirmasi password tidak cocok");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await setupPasswordWithToken({
        token,
        email,
        password,
        confirmPassword,
      });
      if (!result.ok) {
        setError(result.error ?? "Gagal set password");
        setLoading(false);
        return;
      }

      setSuccess(true);
      toast.success("Password berhasil di-set! Mengarahkan ke login...");

      // Auto redirect ke login dengan email pre-filled
      setTimeout(() => {
        router.push(`/login?email=${encodeURIComponent(email)}`);
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal set password";
      setError(message);
      setLoading(false);
    }
  }

  if (success) {
    return (
      <Card className="w-full max-w-md border-emerald-500/30 shadow-2xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          </div>
          <CardTitle className="text-2xl">Password ter-set!</CardTitle>
          <CardDescription>
            Mengarahkan kamu ke halaman login dalam beberapa detik...
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md border-primary/20 shadow-2xl shadow-primary/10">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <div>
          <CardTitle className="text-2xl">Set Password</CardTitle>
          <CardDescription className="mt-1">
            Selamat bergabung! Set password untuk akun{" "}
            <strong className="text-foreground">{email}</strong>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Password baru
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoFocus
                autoComplete="new-password"
                placeholder="Min 6 karakter"
                className={cn(
                  "w-full h-11 px-3 pr-10 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Konfirmasi password
            </label>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="Ulangi password"
              className={cn(
                "w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition",
                confirmPassword.length > 0 &&
                  confirmPassword !== password &&
                  "border-red-500/60"
              )}
            />
            {confirmPassword.length > 0 && confirmPassword !== password && (
              <p className="text-[10px] text-red-400 mt-1">
                Tidak cocok dengan password baru
              </p>
            )}
          </div>

          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full mt-2"
            disabled={loading || !password || !confirmPassword}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                Set Password & Lanjut
              </>
            )}
          </Button>
        </form>

        <p className="text-[10px] text-muted-foreground/60 text-center mt-4">
          Link ini valid selama 7 hari. Kalau sudah expired, minta admin kirim
          ulang invite.
        </p>
      </CardContent>
    </Card>
  );
}
