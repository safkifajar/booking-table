"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requestPasswordReset } from "@/lib/auth-v2/reset-password";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Lupa password staff.
 *
 * Sama seperti milik tamu, jawabannya TIDAK membedakan email terdaftar atau
 * tidak — kalau dibedakan, halaman ini jadi alat menebak siapa saja yang
 * punya akses ke panel admin SOHO.
 */
export function AdminForgotForm() {
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
      await requestPasswordReset(email.trim(), "admin");
      setSent(true);
    } catch (err) {
      setError(
        getActionErrorMessage(err, "Couldn't send the email. Try again.")
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <span className="mx-auto mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {sent ? (
            <MailCheck className="h-6 w-6" />
          ) : (
            <Shield className="h-6 w-6" />
          )}
        </span>
        <CardTitle>{sent ? "Check your email" : "Forgot password?"}</CardTitle>
        <CardDescription>
          {sent
            ? "If that address belongs to a staff account, we've sent a link to reset the password. It expires in 30 minutes."
            : "Enter your staff email and we'll send you a link to set a new password."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {sent ? (
          <>
            <p className="text-center text-xs text-muted-foreground">
              Nothing arrived? Check your spam folder, or ask an admin to reset
              it for you.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@ratssocial.com"
                required
                autoFocus
                autoComplete="email"
                disabled={sending}
                className="mt-1 h-11 w-full rounded-md border border-border bg-input px-3 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-60"
              />
            </label>

            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </form>
        )}

        <div className="border-t border-border pt-4">
          <Link
            href="/login"
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
