"use client";

import * as React from "react";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { adminSignInAction } from "@/lib/auth-v2/admin-actions";
import { cn } from "@/lib/utils";

interface Props {
  next?: string;
  initialError?: string;
  initialEmail?: string;
}

export function AdminLoginForm({ next, initialError, initialEmail }: Props) {
  const [email, setEmail] = React.useState(initialEmail ?? "");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(
    initialError ? translateError(initialError) : null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Invalid email");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await adminSignInAction({
        email,
        password,
        next: next || "/admin",
      });
      if (!result.ok && result.error) {
        setError(result.error);
        setLoading(false);
      }
      // Kalau sukses → redirect (NEXT_REDIRECT thrown internally)
    } catch (err) {
      // NEXT_REDIRECT → biarkan Next.js handle
      const message = err instanceof Error ? err.message : "Failed to sign in";
      if (!message.includes("NEXT_REDIRECT")) {
        setError(message);
        toast.error(message);
      }
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md border-primary/20 shadow-2xl shadow-primary/10">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <div>
          <CardTitle className="text-2xl">Admin Panel</CardTitle>
          <CardDescription className="mt-1">
            Sign in with your SOHO Social House staff account
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@sohosocialhouse.com"
              required
              autoFocus
              autoComplete="email"
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="current-password"
                className={cn(
                  "w-full h-11 px-3 pr-10 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Memverifikasi...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                Sign in to Admin Panel
              </>
            )}
          </Button>
        </form>

        <div className="pt-4 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">
            Lupa password? Hubungi superadmin SOHO.
          </p>
          <p className="text-[10px] text-muted-foreground/60 text-center mt-1">
            Untuk app customer, kunjungi{" "}
            <a
              href={
                typeof window !== "undefined" &&
                window.location.host.startsWith("admin.")
                  ? `https://${window.location.host.replace("admin.", "")}`
                  : "/"
              }
              className="text-primary hover:underline"
            >
              bookingsoho.com
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function translateError(code: string): string {
  if (code === "credentials") return "Incorrect email or password";
  if (code === "no_access") return "You don't have admin access";
  return "Sign-in failed. Please try again";
}
