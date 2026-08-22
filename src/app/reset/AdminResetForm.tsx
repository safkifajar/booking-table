"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resetPassword } from "@/lib/auth-v2/reset-password";
import { getActionErrorMessage } from "@/lib/utils";

const MIN_LENGTH = 8;

/**
 * Form password baru untuk staff.
 *
 * Token sudah diperiksa di server sebelum halaman ini dirender, tapi
 * resetPassword() memeriksanya SEKALI LAGI: halaman bisa terbuka lama sampai
 * tautannya kedaluwarsa sebelum tombol ditekan.
 */
export function AdminResetForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    password.length >= MIN_LENGTH && password === confirm && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await resetPassword(token, email, password);
      if (!res.ok) {
        setError(res.error ?? "Couldn't reset your password");
        setSaving(false);
        return;
      }
      toast.success("Password updated — sign in with your new password");
      router.replace("/login");
    } catch (err) {
      setError(getActionErrorMessage(err, "Couldn't reset your password"));
      setSaving(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <span className="mx-auto mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Shield className="h-6 w-6" />
        </span>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>
          Choose a new password for{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              New password
            </span>
            <div className="relative mt-1">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                disabled={saving}
                className="h-11 w-full rounded-md border border-border bg-input px-3 pr-11 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
              >
                {show ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <span
              className={`mt-1 block text-[10px] ${
                tooShort ? "text-red-400" : "text-muted-foreground"
              }`}
            >
              At least {MIN_LENGTH} characters.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              Confirm password
            </span>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              disabled={saving}
              className="mt-1 h-11 w-full rounded-md border border-border bg-input px-3 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-60"
            />
            {mismatch && (
              <span className="mt-1 block text-[10px] text-red-400">
                Both passwords must match.
              </span>
            )}
          </label>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
