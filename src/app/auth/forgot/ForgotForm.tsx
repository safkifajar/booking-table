"use client";

/**
 * Lupa password? → Pakai magic link.
 *
 * Phase 4 decision: drop password reset flow.
 * - Auth.js v5 tidak ship reset built-in (perlu custom token table + email)
 * - Magic link sudah cover use case "saya lupa password" — kirim link langsung
 *   sign-in, user bisa update password di /profile setelah login
 * - Less attack surface, less code to maintain
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Mail, Check } from "lucide-react";
import { magicLinkAction } from "@/lib/auth-v2/actions";
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
      toast.error("Invalid email");
      return;
    }
    setLoading(true);
    try {
      const result = await magicLinkAction({ email });
      if (result.ok) {
        setSent(true);
      } else if (result.error) {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to send email"));
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
          {sent ? "Check your email" : "Forgot password?"}
        </CardTitle>
        <CardDescription>
          {sent
            ? `We've sent a magic link to ${email}. Click the link to sign in instantly — you can update your password after signing in.`
            : "No worries. We'll send a magic link to your email — click it, sign in instantly, and set a new password if needed in Profile."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sent ? (
          <>
            <div className="rounded-md bg-primary/10 border border-primary/30 p-3 text-sm flex items-start gap-2">
              <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1">Link sent</p>
                <p className="text-xs text-muted-foreground">
                  If it doesn't arrive in your inbox within a few minutes, check
                  your Spam folder. The link is valid for 10 minutes.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/auth">Back to Sign In</Link>
            </Button>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="block w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="email@you.com"
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
              {loading ? "Sending..." : "Send Magic Link"}
            </Button>
            <Link
              href="/auth"
              className="block text-center text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back to Sign In
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
