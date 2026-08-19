"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/auth-v2/reset-password";
import { getActionErrorMessage } from "@/lib/utils";

const MIN_LENGTH = 8;

/**
 * Form menyetel password baru.
 *
 * Token sudah diperiksa di server sebelum halaman ini dirender, tapi
 * resetPassword() memeriksanya SEKALI LAGI: halaman bisa terbuka lama sampai
 * tautannya kedaluwarsa sebelum tombol ditekan.
 */
export function ResetForm({ token, email }: { token: string; email: string }) {
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
      router.replace("/auth");
    } catch (err) {
      setError(getActionErrorMessage(err, "Couldn't reset your password"));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-[calc(100dvh-4rem)] w-full flex-col"
    >
      <div className="mt-4">
        <h1 className="text-2xl font-bold text-white">Set a new password</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          Choose a new password for{" "}
          <span className="font-medium text-white">{email}</span>.
        </p>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="new-password"
              className="block text-xs text-white/70"
            >
              New password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                disabled={saving}
                className="h-12 w-full rounded-md border border-white/25 bg-white/10 px-3 pr-11 text-white transition placeholder:text-white/40 focus:border-white/60 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 transition hover:text-white"
              >
                {show ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p
              className={`text-xs ${tooShort ? "text-red-300" : "text-white/50"}`}
            >
              At least {MIN_LENGTH} characters.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="confirm-password"
              className="block text-xs text-white/70"
            >
              Confirm password
            </label>
            <input
              id="confirm-password"
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              disabled={saving}
              className="h-12 w-full rounded-md border border-white/25 bg-white/10 px-3 text-white transition placeholder:text-white/40 focus:border-white/60 focus:outline-none disabled:opacity-60"
            />
            {mismatch && (
              <p className="text-xs text-red-300">
                Both passwords must match.
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-auto pt-6">
        <Button
          type="submit"
          size="lg"
          disabled={!canSubmit}
          className="h-14 w-full rounded-full bg-[#f0e6d2] text-base font-semibold text-[#8d1312] hover:bg-white disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Update password
        </Button>
      </div>
    </form>
  );
}
